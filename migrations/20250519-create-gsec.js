module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('gsec', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      trade_type: Sequelize.STRING,
      transaction_type: Sequelize.STRING,
      counterparty: Sequelize.STRING,
      deal_number: Sequelize.STRING,
      isin: Sequelize.STRING,
      face_value: Sequelize.DECIMAL(20,6),
      value_date: Sequelize.DATEONLY,
      next_coupon_date: Sequelize.DATEONLY,
      last_coupon_date: Sequelize.DATEONLY,
      number_of_days_interest_accrued: Sequelize.INTEGER,
      number_of_days_for_coupon_period: Sequelize.INTEGER,
      accrued_interest: Sequelize.DECIMAL(20,6),
      coupon_interest: Sequelize.DECIMAL(20,6),
      clean_price: Sequelize.DECIMAL(20,6),
      dirty_price: Sequelize.DECIMAL(20,6),
      accrued_interest_calculation: Sequelize.DECIMAL(20,6),
      accrued_interest_six_decimals: Sequelize.DECIMAL(20,6),
      accrued_interest_for_100: Sequelize.DECIMAL(20,6),
      settlement_amount: Sequelize.DECIMAL(20,6),
      settlement_mode: Sequelize.STRING,
      issue_date: Sequelize.DATEONLY,
      maturity_date: Sequelize.DATEONLY,
      coupon_dates: Sequelize.STRING,
      yield: Sequelize.DECIMAL(20,6),
      created_at: { type: Sequelize.DATE, defaultValue: Sequelize.NOW },
      updated_at: { type: Sequelize.DATE, defaultValue: Sequelize.NOW }
    });
  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('gsec');
  }
};
