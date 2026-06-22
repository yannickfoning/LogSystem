/**
 * LogSystem v7 — PDF export with table format
 */
import PDFDocument from 'pdfkit';

const LEVEL_COLORS = {
  DEBUG: '#888888',
  INFO: '#2E75B6',
  WARNING: '#ED7D31',
  ERROR: '#C00000',
  CRITICAL: '#7030A0',
  FATAL: '#000000',
};

export function generateLogPdf(logs, options = {}) {
  return new Promise((resolve, reject) => {
    const username = options.username || 'Utilisateur';
    const filters = options.filters || '';
    const chunks = [];
    const doc = new PDFDocument({
      size: options.pageSize || 'A4',
      layout: options.orientation === 'landscape' ? 'landscape' : 'portrait',
      margin: 40,
      bufferPages: true,
    });

    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - 80;
    
    // Table configuration
    const colWidths = {
      id: 50,
      timestamp: 70,
      level: 50,
      source: 80,
      service: 70,
      user: 60,
      message: 200,
    };
    
    const tableRowHeight = 20;
    const headerHeight = 25;
    const startY = 100;

    const drawPageHeader = () => {
      doc.font('Helvetica-Bold').fontSize(14).fillColor('#1F4E79')
        .text('LogSystem — Export de Logs', 40, 40, { width: pageWidth, align: 'center' });
      doc.font('Helvetica').fontSize(9).fillColor('#595959')
        .text(`Généré: ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC`, { align: 'center' })
        .text(`Utilisateur: ${username}`, { align: 'center' });
      if (filters) doc.text(`Filtres: ${filters}`, { align: 'center' });
      doc.moveDown(0.5);
      doc.moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).stroke('#CCCCCC');
      doc.moveDown(0.5);
    };

    const drawTableHeader = (y) => {
      const headers = ['ID', 'Date', 'Niveau', 'Source', 'Service', 'User', 'Message'];
      const x = 40;
      let currentX = x;
      
      // Header background
      doc.rect(x, y, pageWidth, headerHeight).fill('#F2F2F2');
      
      // Header text
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#333333');
      headers.forEach((header, i) => {
        const widths = Object.values(colWidths);
        doc.text(header, currentX + 5, y + 8, { width: widths[i] - 10, align: 'left' });
        currentX += widths[i];
      });
      
      // Header bottom border
      doc.moveTo(x, y + headerHeight).lineTo(x + pageWidth, y + headerHeight).stroke('#CCCCCC');
    };

    const drawTableRow = (log, y, index) => {
      const x = 40;
      let currentX = x;
      
      // Alternate row background
      if (index % 2 === 0) {
        doc.rect(x, y, pageWidth, tableRowHeight).fill('#FAFAFA');
      }
      
      doc.font('Helvetica').fontSize(7).fillColor('#333333');
      
      // ID
      doc.text(String(log.id || '').slice(0, 8), currentX + 5, y + 6, { width: colWidths.id - 10, ellipsis: true });
      currentX += colWidths.id;
      
      // Timestamp
      const eventTs = log.event_timestamp || log.timestamp;
      doc.text(fmt(eventTs), currentX + 5, y + 6, { width: colWidths.timestamp - 10, ellipsis: true });
      currentX += colWidths.timestamp;
      
      // Level
      const lvlColor = LEVEL_COLORS[log.log_level] || '#333';
      doc.fillColor(lvlColor).text(log.log_level || '—', currentX + 5, y + 6, { width: colWidths.level - 10 });
      doc.fillColor('#333333');
      currentX += colWidths.level;
      
      // Source
      doc.text(log.source_system || log.log_source || log.source || '—', currentX + 5, y + 6, { width: colWidths.source - 10, ellipsis: true });
      currentX += colWidths.source;
      
      // Service
      doc.text(log.main_service || log.service || '—', currentX + 5, y + 6, { width: colWidths.service - 10, ellipsis: true });
      currentX += colWidths.service;
      
      // User
      doc.text(log.log_user || log.target_user || '—', currentX + 5, y + 6, { width: colWidths.user - 10, ellipsis: true });
      currentX += colWidths.user;
      
      // Message
      doc.text(String(log.message || '').slice(0, 100), currentX + 5, y + 6, { width: colWidths.message - 10, ellipsis: true });
      
      // Row border
      doc.moveTo(x, y + tableRowHeight).lineTo(x + pageWidth, y + tableRowHeight).stroke('#E0E0E0');
    };

    drawPageHeader();
    
    let currentY = startY;
    drawTableHeader(currentY);
    currentY += headerHeight;
    
    logs.forEach((log, index) => {
      // Check if we need a new page
      if (currentY + tableRowHeight > doc.page.height - 60) {
        doc.addPage();
        drawPageHeader();
        currentY = startY;
        drawTableHeader(currentY);
        currentY += headerHeight;
      }
      
      drawTableRow(log, currentY, index);
      currentY += tableRowHeight;
    });

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font('Helvetica').fontSize(8).fillColor('#888888')
        .text(
          `Page ${i - range.start + 1} of ${range.count} | Exporté par ${username} | ${logs.length} logs`,
          40,
          doc.page.height - 30,
          { width: pageWidth, align: 'center' }
        );
    }

    doc.end();
  });
}

function fmt(v) {
  if (!v) return '—';
  const s = v instanceof Date ? v.toISOString() : String(v);
  return s.slice(0, 16).replace('T', ' ');
}

export default { generateLogPdf };
