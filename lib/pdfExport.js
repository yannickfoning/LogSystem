/**
 * LogSystem v6.1 — Export PDF en tableau structuré (A4 landscape)
 */
import PDFDocument from 'pdfkit';

const LEVEL_COLORS = {
  DEBUG: '#888888', INFO: '#2563EB', WARNING: '#D97706',
  ERROR: '#DC2626', CRITICAL: '#7C3AED', FATAL: '#111827',
};

function fmt(v) {
  if (!v) return '—';
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v).slice(0, 19);
    return d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  } catch { return String(v).slice(0, 19); }
}

function trunc(s, n) {
  s = String(s || '—');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// Table columns: label, key, width fraction, optional formatter
const COLS = [
  { label: 'Date événement', w: 0.13, fn: (_, r) => fmt(r.timestamp || r.imported_at) },
  { label: 'Importé le',     w: 0.10, fn: (_, r) => fmt(r.imported_at) },
  { label: 'Niveau',         w: 0.08, key: 'log_level' },
  { label: 'Source',         w: 0.11, fn: (_, r) => trunc(r.log_source || r.source || r.source_server || '—', 20) },
  { label: 'Service',        w: 0.10, fn: (_, r) => trunc(r.service || '—', 18) },
  { label: 'Utilisateur',    w: 0.09, fn: (_, r) => trunc(r.log_user || r.target_user || '—', 15) },
  { label: 'Message',        w: 0.39, fn: (_, r) => trunc(r.message || '—', 100) },
];

export function generateLogPdf(logs, options = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', layout: 'landscape', margin: 25, bufferPages: true
    });

    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const PW = doc.page.width - 50;   // ~792px usable in landscape
    const PH = doc.page.height - 50;
    const ROW_H = 15;
    const HDR_H = 18;
    const colW = COLS.map(c => c.w * PW);

    // ── Page header ──────────────────────────────────────────────────────────
    const drawPageHeader = () => {
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#1E3A5F')
        .text('LogSystem — Export Logs', 25, 20, { width: PW, align: 'center' });
      doc.font('Helvetica').fontSize(7.5).fillColor('#6B7280')
        .text(
          `Généré le ${new Date().toLocaleString('fr-FR')}  ·  ${logs.length} logs  ·  Utilisateur: ${options.username || '—'}` +
          (options.filters ? `  ·  Filtres: ${options.filters}` : ''),
          { align: 'center' }
        );
      doc.moveDown(0.3);
    };

    // ── Table header row ─────────────────────────────────────────────────────
    const drawTableHeader = (y) => {
      doc.rect(25, y, PW, HDR_H).fill('#1E3A5F');
      let x = 25;
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#FFFFFF');
      COLS.forEach((col, i) => {
        doc.text(col.label, x + 3, y + 4, { width: colW[i] - 6, lineBreak: false, ellipsis: true });
        x += colW[i];
      });
      return y + HDR_H;
    };

    // ── Data row ─────────────────────────────────────────────────────────────
    const drawRow = (log, y, even) => {
      doc.rect(25, y, PW, ROW_H).fill(even ? '#F8FAFC' : '#FFFFFF');
      doc.moveTo(25, y + ROW_H).lineTo(25 + PW, y + ROW_H)
        .strokeColor('#E5E7EB').lineWidth(0.3).stroke();

      let x = 25;
      doc.font('Helvetica').fontSize(7);

      COLS.forEach((col, i) => {
        const raw = col.key ? log[col.key] : null;
        const val = col.fn ? col.fn(raw, log) : trunc(raw, 40);

        if (col.key === 'log_level' || col.label === 'Niveau') {
          const lvl = String(val || '').toUpperCase();
          const color = LEVEL_COLORS[lvl] || '#374151';
          doc.font('Helvetica-Bold').fillColor(color)
            .text(val || '—', x + 3, y + 4, { width: colW[i] - 6, lineBreak: false, ellipsis: true });
          doc.font('Helvetica').fillColor('#374151');
        } else {
          doc.fillColor('#374151')
            .text(val || '—', x + 3, y + 4, { width: colW[i] - 6, lineBreak: false, ellipsis: true });
        }
        x += colW[i];
      });
    };

    // ── Build document ───────────────────────────────────────────────────────
    drawPageHeader();
    let y = doc.y + 4;
    y = drawTableHeader(y);

    logs.forEach((log, idx) => {
      if (y + ROW_H > PH + 25) {
        doc.addPage();
        drawPageHeader();
        y = doc.y + 4;
        y = drawTableHeader(y);
      }
      drawRow(log, y, idx % 2 === 0);
      y += ROW_H;
    });

    // ── Page numbers ─────────────────────────────────────────────────────────
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.font('Helvetica').fontSize(7).fillColor('#9CA3AF')
        .text(`Page ${i + 1} / ${range.count}  ·  LogSystem`, 25, doc.page.height - 18,
          { align: 'right', width: PW });
    }

    doc.end();
  });
}
