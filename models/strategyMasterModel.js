const db = require('../db/index');

const StrategyMaster = {
  async getAll() {
    const [rows] = await db.query('SELECT * FROM strategy_master');
    return rows;
  },
  async getById(id) {
    const [rows] = await db.query('SELECT * FROM strategy_master WHERE strategy_id = ?', [id]);
    return rows[0];
  },
  async create(strategy) {
    const [result] = await db.query(
      `INSERT INTO strategy_master (strategy_id, portfolio_name, strategy_type, entity_business_unit) VALUES (?, ?, ?, ?)`,
      [strategy.strategy_id, strategy.portfolio_name, strategy.strategy_type, strategy.entity_business_unit]
    );
    return { ...strategy, id: result.insertId };
  },
  async update(id, strategy) {
    await db.query(
      `UPDATE strategy_master SET portfolio_name=?, strategy_type=?, entity_business_unit=? WHERE strategy_id=?`,
      [strategy.portfolio_name, strategy.strategy_type, strategy.entity_business_unit, id]
    );
    return this.getById(id);
  },
  async delete(id) {
    await db.query('DELETE FROM strategy_master WHERE strategy_id = ?', [id]);
    return { id };
  }
};

module.exports = StrategyMaster;
