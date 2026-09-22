import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import logger from '../config/logger.js';
import { 
  shareLogsByEmail, 
  shareLogsByWhatsApp, 
  generateShareableLink 
} from '../services/emailShareService.js';

const router = Router();
router.use(requireAuth);

/**
 * POST /api/share/email
 * Share logs via email
 */
router.post('/email', async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { emailTo, logIds, subject, options } = req.body;
    
    if (!emailTo) {
      return res.status(400).json({ error: 'Email address required' });
    }
    
    if (!logIds || !Array.isArray(logIds)) {
      return res.status(400).json({ error: 'Log IDs array required' });
    }
    
    const result = await shareLogsByEmail(userId, emailTo, logIds, subject, options);
    res.json(result);
    
  } catch (error) {
    logger.error({ event: 'share_email_error', error: error.message });
    res.status(500).json({ error: error.message || 'Failed to share via email' });
  }
});

/**
 * POST /api/share/whatsapp
 * Share logs via WhatsApp
 */
router.post('/whatsapp', async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { phoneNumber, logIds, message, options } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number required' });
    }
    
    if (!logIds || !Array.isArray(logIds)) {
      return res.status(400).json({ error: 'Log IDs array required' });
    }
    
    const result = await shareLogsByWhatsApp(userId, phoneNumber, logIds, message, options);
    res.json(result);
    
  } catch (error) {
    logger.error({ event: 'share_whatsapp_error', error: error.message });
    res.status(500).json({ error: error.message || 'Failed to share via WhatsApp' });
  }
});

/**
 * POST /api/share/link
 * Generate shareable link for logs
 */
router.post('/link', async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { logIds, expiresHours } = req.body;
    
    if (!logIds || !Array.isArray(logIds)) {
      return res.status(400).json({ error: 'Log IDs array required' });
    }
    
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const result = await generateShareableLink(userId, logIds, baseUrl, expiresHours);
    res.json(result);
    
  } catch (error) {
    logger.error({ event: 'share_link_error', error: error.message });
    res.status(500).json({ error: error.message || 'Failed to generate shareable link' });
  }
});

/**
 * GET /api/share/config
 * Get sharing service configuration status
 */
router.get('/config', async (req, res) => {
  try {
    const config = {
      email: {
        available: process.env.EMAIL_SERVICE === 'true' || 
                   process.env.SMTP_HOST || 
                   process.env.SENDGRID_API_KEY,
        service: process.env.EMAIL_SERVICE || 'none'
      },
      whatsapp: {
        available: process.env.WHATSAPP_SERVICE === 'true' || 
                   process.env.TWILIO_ACCOUNT_SID || 
                   process.env.WHATSAPP_API_KEY,
        service: process.env.WHATSAPP_SERVICE || 'none'
      }
    };
    
    res.json(config);
    
  } catch (error) {
    logger.error({ event: 'share_config_error', error: error.message });
    res.status(500).json({ error: 'Failed to get sharing configuration' });
  }
});

export default router;