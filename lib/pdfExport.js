/**
 * LogSystem v6 — PDF export with metadata and page numbering
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

/**
 * Generate PDF buffer for log export
 * @param {object[]} logs
 * @param {object} options
 * @returns {Promise<Buffer>}
 */
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
    let _entryCount = 0;

    const drawPageHeader = () => {
      doc.font('Helvetica-Bold').fontSize(14).fillColor('#1F4E79')
        .text('LogSystem — Export', 40, 40, { width: pageWidth, align: 'center' });
      doc.font('Helvetica').fontSize(9).fillColor('#595959')
        .text(`Généré: ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC`, { align: 'center' })
        .text(`Utilisateur: ${username}`, { align: 'center' });
      if (filters) doc.text(`Filtres: ${filters}`, { align: 'center' });
      doc.moveDown(0.5);
      doc.moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).stroke('#CCCCCC');
      doc.moveDown(0.5);
    };

    drawPageHeader();

    for (const log of logs) {
      _entryCount++;
      const blockHeight = 120;
      if (doc.y + blockHeight > doc.page.height - 60) {
        doc.addPage();
        drawPageHeader();
      }

      doc.font('Helvetica-Bold').fontSize(10).fillColor('#333')
        .text(`Log ID: ${log.id}`, { underline: true });
      doc.font('Helvetica').fontSize(9).fillColor('#333');
      doc.text(`Timestamp:     ${fmt(log.timestamp)}`);
      const lvlColor = LEVEL_COLORS[log.log_level] || '#333';
      doc.fillColor(lvlColor).text(`Level:         ${log.log_level || ''}`);
      doc.fillColor('#333');
      doc.text(`Source:        ${log.log_source || log.source || '—'}`);
      doc.text(`Service:       ${log.service || '—'}`);
      doc.text(`User (log):    ${log.log_user || log.target_user || '—'}`);
      doc.text(`Message:       ${String(log.message || '').slice(0, 500)}`);

      if (log.file_name || log.imported_at) {
        doc.moveDown(0.3);
        doc.font('Helvetica-Bold').fontSize(9).text('Import Info:');
        doc.font('Helvetica');
        if (log.file_name) doc.text(`  - File: ${log.file_name}`);
        if (log.imported_at) doc.text(`  - Imported: ${fmt(log.imported_at)}`);
        if (log.file_created_at) doc.text(`  - File created: ${fmt(log.file_created_at)}`);
      }

      doc.moveDown(0.5);
      doc.moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).stroke('#EEEEEE');
      doc.moveDown(0.3);
    }

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font('Helvetica').fontSize(8).fillColor('#888888')
        .text(
          `Page ${i - range.start + 1} of ${range.count} | Exporté par ${username}`,
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
  return s.slice(0, 19).replace('T', ' ');
}

export default { generateLogPdf };
