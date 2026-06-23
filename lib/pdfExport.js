/**
 * LogSystem — PDF export as a proper table layout
 */
import PDFDocument from 'pdfkit';

const LEVEL_COLORS = {
  DEBUG:    '#888888',
  INFO:     '#2E75B6',
  WARNING:  '#ED7D31',
  ERROR:    '#C00000',
  CRITICAL: '#7030A0',
  FATAL:    '#1a1a1a',
};

const LEVEL_BG = {
  DEBUG:    '#f0f0f0',
  INFO:     '#dceeff',
  WARNING:  '#fff3e0',
  ERROR:    '#ffe0e0',
  CRITICAL: '#f0e0ff',
  FATAL:    '#e0e0e0',
};

export function generateLogPdf(logs, options = {}) {
  return new Promise((resolve, reject) => {
    const username = options.username || 'Utilisateur';
    const filters  = options.filters  || '';
    const isLandscape = options.orientation === 'landscape';

    const doc = new PDFDocument({
      size: options.pageSize || 'A4',
      layout: isLandscape ? 'landscape' : 'portrait',
      margin: 30,
      bufferPages: true,
    });

    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const PW   = doc.page.width;
    const LEFT = 30;
    const RIGHT = PW - 30;
    const USABLE = RIGHT - LEFT;

    // ── Column definitions ────────────────────────────────────────────────────
    // widths are fractions of USABLE width
    const COLS = isLandscape
      ? [
          { key: 'id',        label: 'ID',        w: 0.04 },
          { key: 'timestamp', label: 'Horodatage', w: 0.12 },
          { key: 'log_level', label: 'Niveau',     w: 0.07 },
          { key: 'source',    label: 'Source',     w: 0.13 },
          { key: 'service',   label: 'Service',    w: 0.10 },
          { key: 'user',      label: 'Utilisateur',w: 0.10 },
          { key: 'message',   label: 'Message',    w: 0.44 },
        ]
      : [
          { key: 'id',        label: 'ID',        w: 0.05 },
          { key: 'timestamp', label: 'Horodatage', w: 0.14 },
          { key: 'log_level', label: 'Niveau',     w: 0.08 },
          { key: 'source',    label: 'Source',     w: 0.15 },
          { key: 'service',   label: 'Service',    w: 0.12 },
          { key: 'message',   label: 'Message',    w: 0.46 },
        ];

    const colWidths = COLS.map(c => Math.floor(c.w * USABLE));

    function getCell(log, key) {
      switch (key) {
        case 'id':        return String(log.id || '');
        case 'timestamp': return fmt(log.event_timestamp || log.timestamp);
        case 'log_level': return log.log_level || '';
        case 'source':    return log.source_system || log.log_source || log.source || '—';
        case 'service':   return log.service || '—';
        case 'user':      return log.log_user || log.target_user || '—';
        case 'message':   return String(log.message || '').slice(0, 300);
        default:          return '';
      }
    }

    // ── Page header ───────────────────────────────────────────────────────────
    function drawPageHeader() {
      const y0 = 30;
      doc.font('Helvetica-Bold').fontSize(13).fillColor('#1F4E79')
         .text('LogSystem — Export des logs', LEFT, y0, { width: USABLE, align: 'center' });
      doc.font('Helvetica').fontSize(8).fillColor('#595959')
         .text(
           `Généré: ${new Date().toISOString().slice(0,19).replace('T',' ')} UTC  |  Utilisateur: ${username}` +
           (filters ? `  |  Filtres: ${filters}` : ''),
           LEFT, doc.y, { width: USABLE, align: 'center' }
         );
      doc.moveDown(0.4);

      // Draw table header
      drawTableHeader(doc.y);
      return doc.y;
    }

    // ── Table header row ──────────────────────────────────────────────────────
    function drawTableHeader(y) {
      const ROW_H = 16;
      // Background
      doc.rect(LEFT, y, USABLE, ROW_H).fill('#1F4E79');

      let x = LEFT;
      COLS.forEach((col, i) => {
        doc.font('Helvetica-Bold').fontSize(7).fillColor('#ffffff')
           .text(col.label, x + 2, y + 4, { width: colWidths[i] - 4, ellipsis: true });
        x += colWidths[i];
      });
      doc.y = y + ROW_H;
    }

    // ── Draw one data row ─────────────────────────────────────────────────────
    function drawRow(log, y, shade) {
      const level = (log.log_level || '').toUpperCase();
      const bgColor = shade
        ? (LEVEL_BG[level] || '#f9f9f9')
        : '#ffffff';

      // Measure message height (tallest cell determines row height)
      const msgIdx = COLS.findIndex(c => c.key === 'message');
      const msgW   = colWidths[msgIdx] - 4;
      const msgText = getCell(log, 'message');
      const textH   = doc.font('Helvetica').fontSize(7).heightOfString(msgText, { width: msgW });
      const ROW_H   = Math.max(14, textH + 6);

      // Background
      doc.rect(LEFT, y, USABLE, ROW_H).fill(bgColor);

      let x = LEFT;
      COLS.forEach((col, i) => {
        const val = getCell(log, col.key);
        const color = col.key === 'log_level' ? (LEVEL_COLORS[level] || '#333') : '#333333';
        const font  = col.key === 'log_level' ? 'Helvetica-Bold' : 'Helvetica';
        doc.font(font).fontSize(7).fillColor(color)
           .text(val, x + 2, y + 3, {
             width: colWidths[i] - 4,
             height: ROW_H - 3,
             ellipsis: true,
             lineBreak: col.key === 'message',
           });
        x += colWidths[i];
      });

      // Bottom separator
      doc.moveTo(LEFT, y + ROW_H).lineTo(RIGHT, y + ROW_H).strokeColor('#e0e0e0').lineWidth(0.3).stroke();

      return ROW_H;
    }

    // ── Main render ───────────────────────────────────────────────────────────
    drawPageHeader();

    let shade = false;
    for (const log of logs) {
      // Estimate row height before rendering
      const msgIdx = COLS.findIndex(c => c.key === 'message');
      const msgW   = colWidths[msgIdx] - 4;
      const textH  = doc.font('Helvetica').fontSize(7).heightOfString(String(log.message || '').slice(0,300), { width: msgW });
      const estH   = Math.max(14, textH + 6);

      const FOOTER_MARGIN = 40;
      if (doc.y + estH > doc.page.height - FOOTER_MARGIN) {
        doc.addPage();
        drawPageHeader();
        shade = false;
      }

      const rowH = drawRow(log, doc.y, shade);
      doc.y += rowH;
      shade = !shade;
    }

    // ── Page numbers ──────────────────────────────────────────────────────────
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font('Helvetica').fontSize(7).fillColor('#888888')
         .text(
           `Page ${i - range.start + 1} / ${range.count}  |  Exporté par ${username}  |  ${logs.length} entrée(s)`,
           LEFT, doc.page.height - 20,
           { width: USABLE, align: 'center' }
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
