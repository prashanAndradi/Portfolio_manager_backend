const { Parser } = require('json2csv');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { parseISO, format } = require('date-fns');

function formatDate(val) {
  if (!val) return '';
  try {
    const dateObj = typeof val === 'string' ? parseISO(val) : val;
    return format(dateObj, 'dd-MMM-yyyy');
  } catch {
    return String(val).split('T')[0];
  }
}

exports.export = async (format, data) => {
  if (format === 'csv') {
    const parser = new Parser();
    return parser.parse(data);
  }
  if (format === 'excel') {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('GSec Report');
    if (data.length > 0) {
      sheet.columns = Object.keys(data[0]).map(key => ({ header: key, key }));
      sheet.addRows(data);
    }
    return workbook.xlsx.writeBuffer();
  }
  if (format === 'pdf') {
    // Pretty PDF table matching the screenshot
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {});

    // Title
    doc.fontSize(24).font('Helvetica-Bold').text('GSec Product Report', { align: 'left', lineGap: 16 });
    doc.moveDown(1.5);

    // Table setup
    const columns = [
      { key: 'portfolio', label: 'Portfolio', width: 70 },
      { key: 'value_date', label: 'Value Date', width: 80 },
      { key: 'maturity_date', label: 'Maturity Date', width: 90 },
      { key: 'isin', label: 'ISIN', width: 110 },
      { key: 'coupon_interest', label: 'Coupon %', width: 65 },
      { key: 'interest', label: 'Interest', width: 65 },
      { key: 'yield', label: 'Yield', width: 55 },
      { key: 'dtm', label: 'DTM', width: 35 },
      { key: 'balance', label: 'Balance', width: 90 }
    ];
    const tableTop = doc.y + 8;
    const rowHeight = 22;
    const cellPadding = 6;
    const startX = doc.page.margins.left;

    // Draw header row background
    doc.rect(startX, tableTop, columns.reduce((a, c) => a + c.width, 0), rowHeight).fillAndStroke('#f8fafc', '#e5e7eb');
    doc.fillColor('#140ce7').fontSize(11).font('Helvetica-Bold'); // Header text color
    let x = startX;
    columns.forEach(col => {
      doc.text(col.label, x + cellPadding, tableTop + 6, { width: col.width - 2 * cellPadding, align: 'left', continued: false });
      x += col.width;
    });
    doc.moveTo(startX, tableTop + rowHeight).lineTo(x, tableTop + rowHeight).stroke('#e5e7eb');

    // Table rows
    doc.font('Helvetica').fontSize(10);
    let y = tableTop + rowHeight;
    (data.length ? data : [{}]).forEach((row, rowIdx) => {
      x = startX;
      // Alternating row background
      if (rowIdx % 2 === 1) {
        doc.rect(startX, y, columns.reduce((a, c) => a + c.width, 0), rowHeight).fill('#f5f6fa').fillColor('#222');
      }
      columns.forEach(col => {
        let val = row[col.key] !== undefined ? row[col.key] : '';
        if (['value_date', 'maturity_date'].includes(col.key)) {
          val = formatDate(val);
        }
        doc.fillColor('#222').text(String(val), x + cellPadding, y + 6, { width: col.width - 2 * cellPadding, align: 'left', continued: false });
        // Vertical grid line
        doc.moveTo(x + col.width, tableTop).lineTo(x + col.width, y + rowHeight).stroke('#e5e7eb');
        x += col.width;
      });
      // Horizontal grid line
      doc.moveTo(startX, y + rowHeight).lineTo(x, y + rowHeight).stroke('#e5e7eb');
      y += rowHeight;
    });
    doc.y = y + 10;
    doc.fillColor('#222');
    doc.end();
    return await new Promise(resolve => {
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });
    });
  }
  throw new Error('Unsupported export format');
};

exports.getMimeType = (format) => {
  if (format === 'csv') return 'text/csv';
  if (format === 'excel') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (format === 'pdf') return 'application/pdf';
  return 'application/octet-stream';
};
