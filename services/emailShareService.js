import pool from '../config/database.js';
import logger from '../config/logger.js';
import crypto from 'node:crypto';
import { sendEmail, sendWhatsApp } from './shareTransports.js';

/**
 * Service pour partager des logs par email et WhatsApp
 * Semaine 4: Fonctionnalités Avancées
 */

/**
 * Convert logs to CSV format
 */
function convertLogsToCSV(logs) {
  if (!logs || logs.length === 0) return '';
  
  const headers = Object.keys(logs[0]);
  const csvRows = [];
  
  // Add header row
  csvRows.push(headers.join(','));
  
  // Add data rows
  for (const log of logs) {
    const values = headers.map(header => {
      const value = log[header];
      // Escape quotes and wrap in quotes if contains comma
      let stringValue = String(value ?? '');
      if (/^[\s]*[=+@-]/.test(stringValue)) stringValue = `'${stringValue}`;
      return `"${stringValue.replace(/"/g, '""')}"`;
    });
    csvRows.push(values.join(','));
  }
  
  return csvRows.join('\n');
}

/**
 * Prepare email content with logs
 */
function prepareEmailContent(logs, subject, includeSummary = true) {
  const csv = convertLogsToCSV(logs);
  const timestamp = new Date().toISOString().split('T')[0];
  
  // Calculate summary statistics
  const summary = includeSummary ? {
    total: logs.length,
    byLevel: logs.reduce((acc, log) => {
      const level = log.log_level || 'UNKNOWN';
      acc[level] = (acc[level] || 0) + 1;
      return acc;
    }, {}),
    dateRange: logs.length > 0 ? {
      earliest: new Date(Math.min(...logs.map(l => new Date(l.timestamp)))).toLocaleString(),
      latest: new Date(Math.max(...logs.map(l => new Date(l.timestamp)))).toLocaleString()
    } : null
  } : null;
  
  let htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">LogSystem Export</h2>
      <p>You have received <strong>${logs.length}</strong> logs exported from LogSystem.</p>
      <p><strong>Export Date:</strong> ${new Date().toLocaleString()}</p>
  `;
  
  if (summary) {
    htmlContent += `
      <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 15px 0;">
        <h3 style="margin-top: 0; color: #555;">Summary</h3>
        <p><strong>Total Logs:</strong> ${summary.total}</p>
        <p><strong>Level Distribution:</strong></p>
        <ul style="margin: 5px 0;">
          ${Object.entries(summary.byLevel).map(([level, count]) => 
            `<li>${escapeHtml(level)}: ${count}</li>`
          ).join('')}
        </ul>
        ${summary.dateRange ? `
          <p><strong>Date Range:</strong> ${summary.dateRange.earliest} to ${summary.dateRange.latest}</p>
        ` : ''}
      </div>
    `;
  }
  
  htmlContent += `
      <p style="color: #666; font-size: 12px;">This export was generated automatically by LogSystem.</p>
    </div>
  `;
  
  return {
    subject: subject || `LogSystem Export - ${timestamp}`,
    html: htmlContent,
    attachments: [{
      filename: `logs-${timestamp}.csv`,
      content: csv
    }]
  };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

/**
 * Prepare shareable link (for sharing logs via URL)
 */
export function prepareShareableLink(baseUrl, logIds, expiresHours = 24) {
  const expiresAt = new Date(Date.now() + expiresHours * 60 * 60 * 1000).toISOString();
  const token = Buffer.from(JSON.stringify({
    logIds,
    expiresAt
  })).toString('base64');
  
  return `${baseUrl}/shared/${token}`;
}

/**
 * Store shared link in database
 */
async function storeSharedLink(dbPool, userId, logIds, expiresHours) {
  const linkId = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + expiresHours * 60 * 60 * 1000);
  
  await dbPool.execute(
    `INSERT INTO shared_links (id, user_id, log_ids, expires_at) VALUES (?, ?, ?, ?)`,
    [linkId, userId, JSON.stringify(logIds), expiresAt]
  );
  
  return linkId;
}

/**
 * Share logs via email (enhanced with actual sending capability)
 */
export async function shareLogsByEmail(userId, emailTo, logIds, subject, options = {}) {
  try {
    if (!emailTo || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(emailTo)) {
      throw new Error('Invalid email address');
    }

    const ids = validateLogIds(logIds);
    const scope = options.accessScope || { sql: 'AND user_id = ?', params: [userId] };
    const placeholders = ids.map(() => '?').join(',');
    const [logs] = await pool.query(
      `SELECT id, timestamp, log_level, message, source, source_server, source_system,
              service, event_type, error_type, target_user, parser_format, user_id, imported_at
       FROM logs WHERE id IN (${placeholders}) ${scope.sql || ''}`,
      [...ids, ...(scope.params || [])]
    );
    if (logs.length !== ids.length) {
      throw new Error('No logs found or access denied');
    }

    const emailContent = prepareEmailContent(logs, subject, options.includeSummary !== false);
    await sendEmail({
      to: emailTo,
      subject: emailContent.subject,
      html: emailContent.html,
      attachments: emailContent.attachments,
    });
    logger.info({ event: 'email_share_sent', userId, logCount: logs.length });
    return {
      success: true,
      message: 'E-mail remis au serveur SMTP.',
      logCount: logs.length
    };
    
  } catch (error) {
    logger.error({ event: 'email_share_error', error: error.message });
    throw error;
  }
}

/**
 * Share logs via WhatsApp (enhanced with actual sending capability)
 */
export async function shareLogsByWhatsApp(userId, phoneNumber, logIds, message, options = {}) {
  try {
    if (!phoneNumber || !phoneNumber.match(/^\+?[1-9]\d{1,14}$/)) {
      throw new Error('Invalid phone number');
    }
    const ids = validateLogIds(logIds, 20);
    const scope = options.accessScope || { sql: 'AND user_id = ?', params: [userId] };
    const placeholders = ids.map(() => '?').join(',');
    const [logs] = await pool.query(
      `SELECT id, timestamp, log_level, message, source, source_server, source_system,
              service, event_type, error_type, target_user, parser_format
       FROM logs WHERE id IN (${placeholders}) ${scope.sql || ''}`,
      [...ids, ...(scope.params || [])]
    );
    
    if (logs.length !== ids.length) {
      throw new Error('No logs found or access denied');
    }
    
    // Prepare message with summary
    const summary = {
      total: logs.length,
      byLevel: logs.reduce((acc, log) => {
        const level = log.log_level || 'UNKNOWN';
        acc[level] = (acc[level] || 0) + 1;
        return acc;
      }, {})
    };
    
    const lines = [
      'LogSystem — log partagé',
      message?.trim() ? `Note : ${message.trim()}` : '',
      ...logs.slice(0, 5).map(log => {
        const source = log.source || log.source_server || log.source_system || 'source inconnue';
        const excerpt = String(log.message || '').replace(/\s+/g, ' ').slice(0, 300);
        return `#${log.id} | ${log.timestamp} | ${log.log_level} | ${source} | ${log.service || 'service inconnu'} | ${log.error_type || log.event_type || log.parser_format || ''}\n${excerpt}`;
      }),
      logs.length > 5 ? `(${logs.length - 5} autre(s) log(s) non inclus)` : '',
    ].filter(Boolean);
    const whatsappMessage = lines.join('\n\n').slice(0, 1400);
    const delivery = await sendWhatsApp({ to: phoneNumber, body: whatsappMessage });
    logger.info({ event: 'whatsapp_share_sent', userId, logCount: logs.length, status: delivery.status });
    return {
      success: true,
      message: 'Message accepté par le fournisseur WhatsApp.',
      providerStatus: delivery.status,
      logCount: logs.length
    };
    
  } catch (error) {
    logger.error({ event: 'whatsapp_share_error', error: error.message });
    throw error;
  }
}

function validateLogIds(logIds, maximum = 500) {
  if (!Array.isArray(logIds) || logIds.length === 0 || logIds.length > maximum) {
    throw new Error(`Provide between 1 and ${maximum} log IDs`);
  }
  const ids = logIds.map(Number);
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error('Invalid log ID');
  }
  return [...new Set(ids)];
}

/**
 * Generate shareable link for logs
 */
export async function generateShareableLink(userId, logIds, baseUrl, expiresHours = 24) {
  try {
    // Validate log IDs
    if (!logIds || !Array.isArray(logIds) || logIds.length === 0) {
      throw new Error('No log IDs provided');
    }
    
    // Verify user has access to these logs
    const placeholders = logIds.map(() => '?').join(',');
    const [logs] = await pool.query(
      `SELECT COUNT(*) as count FROM logs WHERE id IN (${placeholders}) AND user_id = ?`,
      [...logIds, userId]
    );
    
    if (logs[0].count === 0) {
      throw new Error('No logs found or access denied');
    }
    
    // Store link in database
    const linkId = await storeSharedLink(pool, userId, logIds, expiresHours);
    const link = `${baseUrl}/shared/${linkId}`;
    
    logger.info({ 
      event: 'shareable_link_generated', 
      userId, 
      logCount: logIds.length,
      expiresHours,
      linkId
    });
    
    return {
      success: true,
      link,
      linkId,
      expiresAt: new Date(Date.now() + expiresHours * 60 * 60 * 1000).toISOString(),
      logCount: logIds.length
    };
    
  } catch (error) {
    logger.error({ event: 'shareable_link_error', error: error.message });
    throw error;
  }
}
