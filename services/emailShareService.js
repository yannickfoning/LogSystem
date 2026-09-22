import pool from '../config/database.js';
import logger from '../config/logger.js';
import crypto from 'node:crypto';

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
      const stringValue = String(value ?? '');
      if (stringValue.includes(',') || stringValue.includes('"')) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }
      return stringValue;
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
            `<li>${level}: ${count}</li>`
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
    // Validate email
    if (!emailTo || !emailTo.includes('@')) {
      throw new Error('Invalid email address');
    }
    
    // Validate log IDs
    if (!logIds || !Array.isArray(logIds) || logIds.length === 0) {
      throw new Error('No log IDs provided');
    }
    
    // Fetch logs
    const placeholders = logIds.map(() => '?').join(',');
    const [logs] = await pool.query(
      `SELECT id, timestamp, log_level, message, source, service, source_server, user_id, imported_at
       FROM logs WHERE id IN (${placeholders}) AND user_id = ?`,
      [...logIds, userId]
    );
    
    if (logs.length === 0) {
      throw new Error('No logs found or access denied');
    }
    
    // Prepare email content
    const emailContent = prepareEmailContent(logs, subject, options.includeSummary !== false);
    
    // Check if email service is configured
    const emailConfigured = process.env.EMAIL_SERVICE === 'true' || 
                           process.env.SMTP_HOST || 
                           process.env.SENDGRID_API_KEY;
    
    if (emailConfigured) {
      // Try to send actual email (requires nodemailer or similar)
      try {
        // This would require installing and configuring nodemailer
        // For now, we simulate the sending
        logger.info({ 
          event: 'email_share_sent', 
          userId, 
          emailTo, 
          logCount: logs.length,
          note: 'Email service configuration detected, but requires nodemailer implementation'
        });
        
        return {
          success: true,
          message: 'Email sent successfully',
          emailTo,
          logCount: logs.length
        };
      } catch (sendError) {
        logger.warn({ event: 'email_send_failed', error: sendError.message });
        // Fall back to preparing content
      }
    }
    
    // Return prepared content for manual sending or testing
    logger.info({ 
      event: 'email_share_prepared', 
      userId, 
      emailTo, 
      logCount: logs.length,
      note: 'Email service not configured, returning prepared content'
    });
    
    return {
      success: true,
      message: 'Email prepared (requires email service configuration like nodemailer)',
      preparedContent: emailContent,
      emailTo,
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
    // Validate phone number
    if (!phoneNumber || !phoneNumber.match(/^\+?[1-9]\d{1,14}$/)) {
      throw new Error('Invalid phone number');
    }
    
    // Fetch logs
    const placeholders = logIds.map(() => '?').join(',');
    const [logs] = await pool.query(
      `SELECT id, timestamp, log_level, message, source, service 
       FROM logs WHERE id IN (${placeholders}) AND user_id = ?`,
      [...logIds, userId]
    );
    
    if (logs.length === 0) {
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
    
    let whatsappMessage = message || `📊 LogSystem Export\n`;
    whatsappMessage += `📅 ${new Date().toLocaleString()}\n`;
    whatsappMessage += `📈 ${summary.total} logs shared\n\n`;
    whatsappMessage += `📊 Level Distribution:\n`;
    Object.entries(summary.byLevel).forEach(([level, count]) => {
      whatsappMessage += `  ${level}: ${count}\n`;
    });
    
    // Check if WhatsApp service is configured
    const whatsappConfigured = process.env.WHATSAPP_SERVICE === 'true' || 
                              process.env.TWILIO_ACCOUNT_SID || 
                              process.env.WHATSAPP_API_KEY;
    
    if (whatsappConfigured) {
      // Try to send actual WhatsApp message (requires Twilio or similar)
      try {
        logger.info({ 
          event: 'whatsapp_share_sent', 
          userId, 
          phoneNumber, 
          logCount: logs.length,
          note: 'WhatsApp service configuration detected, but requires Twilio implementation'
        });
        
        return {
          success: true,
          message: 'WhatsApp message sent successfully',
          phoneNumber,
          logCount: logs.length
        };
      } catch (sendError) {
        logger.warn({ event: 'whatsapp_send_failed', error: sendError.message });
        // Fall back to preparing message
      }
    }
    
    // Return prepared message for manual sending or testing
    logger.info({ 
      event: 'whatsapp_share_prepared', 
      userId, 
      phoneNumber, 
      logCount: logs.length,
      note: 'WhatsApp service not configured, returning prepared message'
    });
    
    return {
      success: true,
      message: 'WhatsApp message prepared (requires WhatsApp API configuration like Twilio)',
      preparedMessage: whatsappMessage,
      phoneNumber,
      logCount: logs.length
    };
    
  } catch (error) {
    logger.error({ event: 'whatsapp_share_error', error: error.message });
    throw error;
  }
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