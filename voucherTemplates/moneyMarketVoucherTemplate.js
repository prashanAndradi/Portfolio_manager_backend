 // Voucher PDF template for Money Market Deal using pdfkit
const PDFDocument = require('pdfkit');

// Helper: Format value to 4 decimal places, truncating not rounding
function formatAmount(val) {
  return (Math.trunc(Number(val) * 10000) / 10000).toFixed(4);
}

// Helper: Format date as YYYY-MM-DD
function formatDate(dt) {
  if (!dt) return '';
  const d = new Date(dt);
  return d.toISOString().slice(0, 10);
}

module.exports = async function generateMoneyMarketVoucherPDF(res, deal, ledgerEntries, companyInfo, approvalHistory) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=DealVoucher_${deal.deal_number}.pdf`);
  doc.pipe(res);

  // Branding header
  doc
    .fontSize(10)
    .fillColor('#444')
    .text(companyInfo.name, 40, 15, { align: 'left' })
    .fillColor('#888')
    .text(`${companyInfo.year} All Rights Reserved`, 0, 15, { align: 'right' });

  doc.moveDown(2);
  // Tag as header (provided tag)
  doc
    .fontSize(18)
    .fillColor('#223')
    .text(companyInfo.tag, { align: 'center', underline: true });

  doc.moveDown();
  doc.fontSize(14).fillColor('#000').text('Money Market Deal Voucher', { align: 'center' });
  doc.moveDown();

  // Deal details
  doc.fontSize(11);
  doc.text(`Deal Number: ${deal.deal_number}`);
  doc.text(`Product: ${deal.deal_type}`);
  doc.text(`Trade Date: ${formatDate(deal.trade_date)}`);
  doc.text(`Value Date: ${formatDate(deal.value_date)}`);
  doc.text(`Maturity Date: ${formatDate(deal.maturity_date)}`);
  doc.text(`Currency: ${deal.currency}`);
  doc.text(`Principal: ${formatAmount(deal.principal_amount)}`);
  doc.text(`Interest Rate: ${deal.interest_rate}%`);
  doc.text(`Maturity Value: ${formatAmount(deal.maturity_value)}`);
  doc.text(`Counterparty: ${deal.counterparty_name}`);
  doc.text(`Settlement Bank: ${deal.settlement_bank}`);
  doc.text(`Settlement Account: ${deal.settlement_account}`);
  doc.text(`Status: ${deal.status}`);
  doc.text(`Current Approval Level: ${deal.current_approval_level}`);
  doc.moveDown();

  // Approval history
  if (approvalHistory && approvalHistory.length > 0) {
    doc.fontSize(12).fillColor('#223').text('Approval History:', { underline: true });
    doc.fontSize(10).fillColor('#000');
    approvalHistory.forEach((item, idx) => {
      doc.text(`${idx + 1}. ${item.level} by ${item.user} at ${formatDate(item.time)}`);
    });
    doc.moveDown();
  }

  // Ledger Entries Table
  if (ledgerEntries && ledgerEntries.length > 0) {
    doc.fontSize(12).fillColor('#223').text('Ledger Entries:', { underline: true });
    doc.fontSize(10).fillColor('#000');
    doc.text('');
    doc.text('Account Name           | Debit      | Credit     | Description');
    doc.text('--------------------------------------------------------------');
    ledgerEntries.forEach(entry => {
      doc.text(
        `${entry.account_name.padEnd(22)} | ${formatAmount(entry.debit_amount).padEnd(10)} | ${formatAmount(entry.credit_amount).padEnd(10)} | ${entry.description}`
      );
    });
    doc.moveDown();
  }

  // Comments/Remarks
  if (deal.comment) {
    doc.fontSize(11).fillColor('#223').text('Remarks:', { underline: true });
    doc.fontSize(10).fillColor('#000').text(deal.comment);
    doc.moveDown();
  }

  // Footer
  doc.moveDown(2);
  doc.fontSize(9).fillColor('#888').text(companyInfo.footer, { align: 'center' });

  doc.end();
};
