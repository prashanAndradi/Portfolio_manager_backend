const pool = require('../config/db');

// CREATE broker
exports.create = async (req, res) => {
  try {
    const {
      broker_code, broker_name, building_number, street_name, street_name2, city, province, zip_code, country,
      contact_name, contact_phone, contact_mobile, contact_fax, contact_email, broker_type,
      brokerage_method, brokerage_cal_method_id, brokerage_input_percentage,
      brokerage_settlement_method_id, settlement_account_number
    } = req.body;

    const [result] = await pool.query(
      `INSERT INTO brokers (
        broker_code, broker_name, building_number, street_name, street_name2, city, province, zip_code, country,
        contact_name, contact_phone, contact_mobile, contact_fax, contact_email, broker_type,
        brokerage_method, brokerage_cal_method_id, brokerage_input_percentage,
        brokerage_settlement_method_id, settlement_account_number
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        broker_code, broker_name, building_number, street_name, street_name2, city, province, zip_code, country,
        contact_name, contact_phone, contact_mobile, contact_fax, contact_email, broker_type,
        brokerage_method, brokerage_cal_method_id, brokerage_input_percentage,
        brokerage_settlement_method_id, settlement_account_number
      ]
    );
    res.status(201).json({ id: result.insertId, ...req.body });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// GET all brokers
exports.getAll = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM brokers ORDER BY broker_name');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET broker by id
exports.getById = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM brokers WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Broker not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// UPDATE broker
exports.update = async (req, res) => {
  try {
    const {
      broker_code, broker_name, building_number, street_name, street_name2, city, province, zip_code, country,
      contact_name, contact_phone, contact_mobile, contact_fax, contact_email, broker_type,
      brokerage_method, brokerage_cal_method_id, brokerage_input_percentage,
      brokerage_settlement_method_id, settlement_account_number
    } = req.body;
    const [result] = await pool.query(
      `UPDATE brokers SET
        broker_code=?, broker_name=?, building_number=?, street_name=?, street_name2=?, city=?, province=?, zip_code=?, country=?,
        contact_name=?, contact_phone=?, contact_mobile=?, contact_fax=?, contact_email=?, broker_type=?,
        brokerage_method=?, brokerage_cal_method_id=?, brokerage_input_percentage=?,
        brokerage_settlement_method_id=?, settlement_account_number=?
      WHERE id=?`,
      [
        broker_code, broker_name, building_number, street_name, street_name2, city, province, zip_code, country,
        contact_name, contact_phone, contact_mobile, contact_fax, contact_email, broker_type,
        brokerage_method, brokerage_cal_method_id, brokerage_input_percentage,
        brokerage_settlement_method_id, settlement_account_number,
        req.params.id
      ]
    );
    res.json({ id: req.params.id, ...req.body });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// DELETE broker
exports.remove = async (req, res) => {
  try {
    await pool.query('DELETE FROM brokers WHERE id = ?', [req.params.id]);
    res.json({ message: 'Broker deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
