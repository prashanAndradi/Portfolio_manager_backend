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

const EXPORT_COLUMNS = [
  { key: 'portfolio', label: 'Portfolio' },
  { key: 'value_date', label: 'Value Date' },
  { key: 'maturity_date', label: 'Maturity Date' },
  { key: 'isin', label: 'ISIN' },
  { key: 'coupon_interest', label: 'Coupon Interest' },
  { key: 'yield', label: 'Yield' },
  { key: 'dtm', label: 'DTM' },
  { key: 'balance', label: 'Balance' }
];

function formatNumber2(val) {
  if (val === undefined || val === null || val === '') return '';
  const n = Number(val);
  if (isNaN(n)) return val;
  // Truncate (not round) to 2 decimals
  const truncated = Math.trunc(n * 100) / 100;
  // Format with comma separators and exactly 2 decimal places
  return new Intl.NumberFormat('en-US', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  }).format(truncated);
}

function preprocessExportData(data) {
  return data.map(row => {
    const mapped = {};
    EXPORT_COLUMNS.forEach(col => {
      let val = row[col.key];
      if (col.key === 'value_date' || col.key === 'maturity_date') {
        val = formatDate(val);
      }
      // Format numbers to 2 decimals with comma separators for specific fields
      if ([
        'coupon_interest',
        'yield',
        'balance'
      ].includes(col.key)) {
        val = formatNumber2(val);
      }
      // DTM is days, so just convert to integer (no decimals or commas)
      if (col.key === 'dtm') {
        const n = Number(val);
        val = isNaN(n) ? val : Math.trunc(n).toString();
      }
      mapped[col.key] = val !== undefined && val !== null ? val : '';
    });
    return mapped;
  });
}

exports.export = async (format, data) => {
  // Always format dates for export
  const processedData = preprocessExportData(data);

  if (format === 'csv') {
    const parser = new Parser({ fields: EXPORT_COLUMNS.map(col => ({ label: col.label, value: col.key })) });
    return parser.parse(processedData);
  }
  if (format === 'excel') {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('GSec Report');
    sheet.columns = EXPORT_COLUMNS.map(col => ({ header: col.label, key: col.key }));
    sheet.addRows(processedData);
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

    // Table setup with alignment options
    const columns = [
      { key: 'portfolio', label: 'Portfolio', width: 60, align: 'left' },
      { key: 'value_date', label: 'Value Date', width: 70, align: 'center' },
      { key: 'maturity_date', label: 'Maturity Date', width: 80, align: 'center' },
      { key: 'isin', label: 'ISIN', width: 90, align: 'left' },
      { key: 'coupon_interest', label: 'Coupon Interest', width: 70, align: 'right' },
      { key: 'yield', label: 'Yield', width: 45, align: 'right' },
      { key: 'dtm', label: 'DTM', width: 50, align: 'center' },
      { key: 'balance', label: 'Balance', width: 80, align: 'right' }
        ]; // keep in sync with EXPORT_COLUMNS
    const tableTop = doc.y + 8;
    const rowHeight = 30; // Increased for more vertical space
    const cellPadding = 6;
    const startX = doc.page.margins.left;

    // Draw header row background
    doc.rect(startX, tableTop, columns.reduce((a, c) => a + c.width, 0), rowHeight).fillAndStroke('#f8fafc', '#e5e7eb');
    doc.fillColor('#140ce7').fontSize(11).font('Helvetica-Bold'); // Header text color
    let x = startX;
    columns.forEach(col => {
      doc.text(col.label, x + cellPadding, tableTop + 8, { 
        width: col.width - 2 * cellPadding, 
        align: col.align || 'left', 
        continued: false 
      });
      x += col.width;
    });
    doc.moveTo(startX, tableTop + rowHeight).lineTo(x, tableTop + rowHeight).stroke('#e5e7eb');

    // Table rows
    doc.font('Helvetica').fontSize(10);
    let y = tableTop + rowHeight;
    (processedData.length ? processedData : [{}]).forEach((row, rowIdx) => {
      x = startX;
      // Alternating row background
      if (rowIdx % 2 === 1) {
        doc.rect(startX, y, columns.reduce((a, c) => a + c.width, 0), rowHeight).fill('#f5f6fa').fillColor('#222');
      }
      columns.forEach(col => {
        let val = row[col.key] !== undefined ? row[col.key] : '';
        // Values are already formatted in preprocessExportData
        // Vertically center text in row with custom alignment
        doc.fillColor('#222').text(String(val), x + cellPadding, y + (rowHeight - 12) / 2, { 
          width: col.width - 2 * cellPadding, 
          align: col.align || 'left', 
          continued: false 
        });
        // Vertical grid line
        doc.moveTo(x + col.width, tableTop).lineTo(x + col.width, y + rowHeight).stroke('#e5e7eb');
        x += col.width;
      });
      // Horizontal grid line
      doc.moveTo(startX, y + rowHeight).lineTo(x, y + rowHeight).stroke('#e5e7eb');
      y += rowHeight;
    });
    // Calculate total balance
    const totalBalance = data.reduce((sum, row) => sum + (Number(row.balance) || 0), 0);
    const formattedTotalBalance = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.trunc(totalBalance * 100) / 100);
    doc.y = y + 10;
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#140ce7');
    const totalText = `Total Balance: ${formattedTotalBalance}`;
    // Center the text on the A4 page
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const textWidth = doc.widthOfString(totalText);
    const centerX = doc.page.margins.left + (pageWidth - textWidth) / 2;
    doc.text(totalText, centerX, doc.y, { align: 'left' });
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