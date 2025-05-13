module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('isin_master', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      isin_issuer: { type: Sequelize.STRING, allowNull: false },
      isin_number: { type: Sequelize.STRING, allowNull: false },
      issue_date: { type: Sequelize.DATE, allowNull: false },
      maturity_date: { type: Sequelize.DATE, allowNull: false },
      coupon_rate: { type: Sequelize.DECIMAL(10, 4), allowNull: false },
      series: { type: Sequelize.STRING, allowNull: true },
      coupon_date_1: { type: Sequelize.DATE, allowNull: false },
      coupon_date_2: { type: Sequelize.DATE, allowNull: false },
      day_basis: { type: Sequelize.INTEGER, allowNull: false },
      currency: { type: Sequelize.STRING, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP') }
    });
  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('isin_master');
  }
};
