// Model for Settlement Account Master
const db = require('../db'); // adjust if your db connection file is different

const SettlementAccount = {
  async create(settlementAccount) {
    const query = `INSERT INTO settlement_accounts (
      bank_name, bank_payment_code, bank_code,
      address_building_number, address_street_name, address_street_name2, address_city, address_province, address_zip_code, address_country,
      contact_name, contact_phone, contact_mobile, contact_fax, contact_email,
      account_type, bank_account_number, bank_branch
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const values = [
      settlementAccount.bankName,
      settlementAccount.bankPaymentCode,
      settlementAccount.bankCode,
      settlementAccount.address.buildingNumber,
      settlementAccount.address.streetName,
      settlementAccount.address.streetName2,
      settlementAccount.address.city,
      settlementAccount.address.province,
      settlementAccount.address.zipCode,
      settlementAccount.address.country,
      settlementAccount.contact.name,
      settlementAccount.contact.phone,
      settlementAccount.contact.mobile,
      settlementAccount.contact.fax,
      settlementAccount.contact.email,
      settlementAccount.accountType,
      settlementAccount.bankAccountNumber,
      settlementAccount.bankBranch
    ];
    const [result] = await db.query(query, values);
    return result.insertId;
  }
};

SettlementAccount.find = async function (search = '') {
  let query = 'SELECT * FROM settlement_accounts';
  let params = [];
  if (search) {
    query += ' WHERE bank_name LIKE ?';
    params.push(`%${search}%`);
  }
  const [rows] = await db.query(query, params);
  return rows;
};

SettlementAccount.update = async function (id, data) {
  const query = `UPDATE settlement_accounts SET
    bank_name=?, bank_payment_code=?, bank_code=?,
    address_building_number=?, address_street_name=?, address_street_name2=?, address_city=?, address_province=?, address_zip_code=?, address_country=?,
    contact_name=?, contact_phone=?, contact_mobile=?, contact_fax=?, contact_email=?,
    account_type=?, bank_account_number=?, bank_branch=?
    WHERE id=?`;
  const values = [
    data.bankName, data.bankPaymentCode, data.bankCode,
    data.address.buildingNumber, data.address.streetName, data.address.streetName2, data.address.city, data.address.province, data.address.zipCode, data.address.country,
    data.contact.name, data.contact.phone, data.contact.mobile, data.contact.fax, data.contact.email,
    data.accountType, data.bankAccountNumber, data.bankBranch,
    id
  ];
  await db.query(query, values);
};

module.exports = SettlementAccount;
