import { Router } from 'express';
import logger from '../config/logger.js';
import pool from '../config/database.js';
import { requireAuth, requireAdmin, userScope } from '../middleware/auth.js';
import { recordAudit } from '../middleware/audit.js';
import { validateBody, externalSourceSchema } from '../middleware/validation.js';
import crypto from 'crypto';
import { 
  initializeExternalSources, 
  startPolling, 
  stopPolling, 
  getPollerStatus 
} from '../services/externalLogSourceService.js';

const router = Router();
router.use(requireAuth);

/**
 * GET /api/external-sources
 * List all external log sources
 */
router.get('/', async (req, res) => {
  try {
    const scope = userScope(req);
    const isAdmin = req.session?.user?.role === 'admin';
    
    let sql = 'SELECT * FROM external_log_sources WHERE 1=1';
    const params = [];
    
    if (!isAdmin) {
      sql += ' AND user_id = ?';
      params.push(req.session.user.id);
    } else if (scope.sql) {
      sql += scope.sql;
      params.push(...scope.params);
    }
    
    sql += ' ORDER BY created_at DESC';
    
    const [sources] = await pool.execute(sql, params);
    
    // Add current poller status
    const pollerStatus = getPollerStatus();
    const sourcesWithStatus = sources.map(source => ({
      ...source,
      is_polling: pollerStatus.pollers?.some(p => p.sourceId === source.id) || false
    }));
    
    res.json(sourcesWithStatus);
  } catch (e) {
    logger.error({ event: 'external_sources_list_failed', error: e.message }, '[EXTERNAL_SOURCES]');
    res.status(500).json({ error: 'Failed to fetch external sources' });
  }
});

/**
 * POST /api/external-sources
 * Create a new external log source (admin only)
 */
router.post('/', requireAdmin, validateBody(externalSourceSchema), async (req, res) => {
  try {
    const {
      name,
      description,
      source_type,
      endpoint_url,
      service_name,
      auth_token,
      custom_headers,
      poll_interval,
      is_active,
      user_id
    } = req.body;

    const webhook_secret = source_type === 'webhook' 
      ? crypto.randomBytes(32).toString('hex') 
      : null;

    const [result] = await pool.execute(
      `INSERT INTO external_log_sources 
       (name, description, source_type, endpoint_url, service_name, auth_token, 
        custom_headers, poll_interval, is_active, user_id, webhook_secret) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        description || null,
        source_type,
        endpoint_url || null,
        service_name || null,
        auth_token || null,
        custom_headers ? JSON.stringify(custom_headers) : null,
        poll_interval || 'normal',
        is_active !== undefined ? (is_active ? 1 : 0) : 1,
        user_id || null,
        webhook_secret
      ]
    );

    await recordAudit({
      userId: req.session.user.id,
      userEmail: req.session.user.email,
      action: 'create_external_source',
      resourceType: 'external_source',
      resourceId: String(result.insertId),
      details: `Created external source: ${name}`,
      ipAddress: req.ip,
    });

    // Start polling if active and not webhook
    if (is_active !== false && source_type !== 'webhook') {
      const [newSource] = await pool.execute(
        'SELECT * FROM external_log_sources WHERE id = ?',
        [result.insertId]
      );
      startPolling(newSource[0]);
    }

    res.json({ success: true, id: result.insertId, webhook_secret });
  } catch (e) {
    logger.error({ event: 'external_source_create_failed', error: e.message }, '[EXTERNAL_SOURCES]');
    res.status(500).json({ error: 'Failed to create external source' });
  }
});

/**
 * PUT /api/external-sources/:id
 * Update an external log source (admin only)
 */
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const sourceId = parseInt(req.params.id);
    const {
      name,
      description,
      source_type,
      endpoint_url,
      service_name,
      auth_token,
      custom_headers,
      poll_interval,
      is_active,
      user_id
    } = req.body;

    const fields = [];
    const params = [];

    if (name !== undefined) {
      fields.push('name = ?');
      params.push(name);
    }
    if (description !== undefined) {
      fields.push('description = ?');
      params.push(description);
    }
    if (source_type !== undefined) {
      fields.push('source_type = ?');
      params.push(source_type);
    }
    if (endpoint_url !== undefined) {
      fields.push('endpoint_url = ?');
      params.push(endpoint_url);
    }
    if (service_name !== undefined) {
      fields.push('service_name = ?');
      params.push(service_name);
    }
    if (auth_token !== undefined) {
      fields.push('auth_token = ?');
      params.push(auth_token);
    }
    if (custom_headers !== undefined) {
      fields.push('custom_headers = ?');
      params.push(JSON.stringify(custom_headers));
    }
    if (poll_interval !== undefined) {
      fields.push('poll_interval = ?');
      params.push(poll_interval);
    }
    if (is_active !== undefined) {
      fields.push('is_active = ?');
      params.push(is_active ? 1 : 0);
    }
    if (user_id !== undefined) {
      fields.push('user_id = ?');
      params.push(user_id);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(sourceId);
    await pool.execute(
      `UPDATE external_log_sources SET ${fields.join(', ')} WHERE id = ?`,
      params
    );

    await recordAudit({
      userId: req.session.user.id,
      userEmail: req.session.user.email,
      action: 'update_external_source',
      resourceType: 'external_source',
      resourceId: String(sourceId),
      details: `Updated external source ${sourceId}`,
      ipAddress: req.ip,
    });

    // Restart polling if needed
    const [updatedSource] = await pool.execute(
      'SELECT * FROM external_log_sources WHERE id = ?',
      [sourceId]
    );
    
    if (updatedSource.length > 0) {
      stopPolling(sourceId);
      if (updatedSource[0].is_active && updatedSource[0].source_type !== 'webhook') {
        startPolling(updatedSource[0]);
      }
    }

    res.json({ success: true });
  } catch (e) {
    logger.error({ event: 'external_source_update_failed', error: e.message }, '[EXTERNAL_SOURCES]');
    res.status(500).json({ error: 'Failed to update external source' });
  }
});

/**
 * DELETE /api/external-sources/:id
 * Delete an external log source (admin only)
 */
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const sourceId = parseInt(req.params.id);
    
    stopPolling(sourceId);
    
    const [result] = await pool.execute(
      'DELETE FROM external_log_sources WHERE id = ?',
      [sourceId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'External source not found' });
    }

    await recordAudit({
      userId: req.session.user.id,
      userEmail: req.session.user.email,
      action: 'delete_external_source',
      resourceType: 'external_source',
      resourceId: String(sourceId),
      details: `Deleted external source ${sourceId}`,
      ipAddress: req.ip,
    });

    res.json({ success: true });
  } catch (e) {
    logger.error({ event: 'external_source_delete_failed', error: e.message }, '[EXTERNAL_SOURCES]');
    res.status(500).json({ error: 'Failed to delete external source' });
  }
});

/**
 * POST /api/external-sources/:id/test
 * Test connection to an external source
 */
router.post('/:id/test', requireAdmin, async (req, res) => {
  try {
    const sourceId = parseInt(req.params.id);
    const [sources] = await pool.execute(
      'SELECT * FROM external_log_sources WHERE id = ?',
      [sourceId]
    );

    if (sources.length === 0) {
      return res.status(404).json({ error: 'External source not found' });
    }

    const source = sources[0];
    
    // Manual single poll for testing
    const { pollSource } = await import('../services/externalLogSourceService.js');
    const result = await pollSource(source);

    res.json({ 
      success: true, 
      message: 'Connection test successful',
      result 
    });
  } catch (e) {
    logger.error({ event: 'external_source_test_failed', error: e.message }, '[EXTERNAL_SOURCES]');
    res.status(500).json({ 
      error: 'Connection test failed', 
      details: e.message 
    });
  }
});

/**
 * POST /api/external-sources/:id/start
 * Start polling for a source
 */
router.post('/:id/start', requireAdmin, async (req, res) => {
  try {
    const sourceId = parseInt(req.params.id);
    const [sources] = await pool.execute(
      'SELECT * FROM external_log_sources WHERE id = ?',
      [sourceId]
    );

    if (sources.length === 0) {
      return res.status(404).json({ error: 'External source not found' });
    }

    const source = sources[0];
    
    if (source.source_type === 'webhook') {
      return res.status(400).json({ error: 'Webhooks are passive, cannot start polling' });
    }

    await pool.execute(
      'UPDATE external_log_sources SET is_active = 1 WHERE id = ?',
      [sourceId]
    );

    startPolling(source);

    res.json({ success: true, message: 'Polling started' });
  } catch (e) {
    logger.error({ event: 'external_source_start_failed', error: e.message }, '[EXTERNAL_SOURCES]');
    res.status(500).json({ error: 'Failed to start polling' });
  }
});

/**
 * POST /api/external-sources/:id/stop
 * Stop polling for a source
 */
router.post('/:id/stop', requireAdmin, async (req, res) => {
  try {
    const sourceId = parseInt(req.params.id);
    
    stopPolling(sourceId);
    
    await pool.execute(
      'UPDATE external_log_sources SET is_active = 0 WHERE id = ?',
      [sourceId]
    );

    res.json({ success: true, message: 'Polling stopped' });
  } catch (e) {
    logger.error({ event: 'external_source_stop_failed', error: e.message }, '[EXTERNAL_SOURCES]');
    res.status(500).json({ error: 'Failed to stop polling' });
  }
});

/**
 * GET /api/external-sources/status
 * Get overall poller status
 */
router.get('/status', requireAdmin, async (req, res) => {
  try {
    const status = getPollerStatus();
    res.json(status);
  } catch (e) {
    logger.error({ event: 'poller_status_failed', error: e.message }, '[EXTERNAL_SOURCES]');
    res.status(500).json({ error: 'Failed to get poller status' });
  }
});

/**
 * POST /api/external-sources/initialize
 * Re-initialize all external sources (admin only)
 */
router.post('/initialize', requireAdmin, async (req, res) => {
  try {
    const count = await initializeExternalSources();
    res.json({ success: true, message: `Initialized ${count} external sources` });
  } catch (e) {
    logger.error({ event: 'external_sources_init_failed', error: e.message }, '[EXTERNAL_SOURCES]');
    res.status(500).json({ error: 'Failed to initialize external sources' });
  }
});

export default router;