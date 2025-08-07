const gsecReportService = require('../services/gsecReportService');
const reportExporter = require('../utils/reportExporter');

// GET /api/reports/gsec
exports.getGsecReport = async (req, res) => {
  try {
    const {
      asAtDate,
      portfolio,
      isin,
      valueDate,
      maturityDate,
      format,
      page = 1,
      pageSize = 20
    } = req.query;

    // Validate required params
    if (!asAtDate) {
      return res.status(400).json({ error: 'asAtDate is required' });
    }

    // Fetch report data
    const { data, total } = await gsecReportService.getGsecReport({
      asAtDate,
      portfolio,
      isin,
      valueDate,
      maturityDate,
      page: Number(page),
      pageSize: Number(pageSize)
    });

    // Handle export formats
    if (format === 'csv' || format === 'excel' || format === 'pdf') {
      const fileBuffer = await reportExporter.export(format, data);
      res.setHeader('Content-Disposition', `attachment; filename=gsec_report.${format === 'excel' ? 'xlsx' : format}`);
      res.setHeader('Content-Type', reportExporter.getMimeType(format));
      return res.send(fileBuffer);
    }

    // Default: return paginated JSON
    res.json({ data, total, page: Number(page), pageSize: Number(pageSize) });
  } catch (err) {
    console.error('GSec Report Error:', err);
    res.status(500).json({ error: 'Failed to generate GSec report' });
  }
};
