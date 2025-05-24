const db = require('../config/db');

const CounterpartyJoint = {
  create: async (data) => {
    const sql = `INSERT INTO counterparty_master_joint (
      title, short_name, long_name, id_type, house_number, street_name, province, postal_code, city, country, telephone, email, mobile
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const values = [
      data.title,
      data.short_name,
      data.long_name,
      data.id_type,
      data.house_number,
      data.street_name,
      data.province,
      data.postal_code,
      data.city,
      data.country,
      data.telephone,
      data.email,
      data.mobile
    ];
    const [result] = await db.query(sql, values);
    return result;
  }
};

module.exports = CounterpartyJoint;
