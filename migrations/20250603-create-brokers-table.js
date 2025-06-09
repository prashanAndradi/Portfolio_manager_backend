module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('Brokers', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      broker_code: { type: Sequelize.STRING(50), allowNull: false, unique: true },
      broker_name: { type: Sequelize.STRING(100), allowNull: false },
      building_number: Sequelize.STRING(50),
      street_name: Sequelize.STRING(100),
      street_name2: Sequelize.STRING(100),
      city: Sequelize.STRING(100),
      province: Sequelize.STRING(100),
      zip_code: Sequelize.STRING(20),
      country: Sequelize.STRING(100),
      contact_name: Sequelize.STRING(100),
      contact_phone: Sequelize.STRING(30),
      contact_mobile: Sequelize.STRING(30),
      contact_fax: Sequelize.STRING(30),
      contact_email: Sequelize.STRING(100),
      broker_type: Sequelize.STRING(20),
      brokerage_method: Sequelize.STRING(20),
      brokerage_cal_method_id: Sequelize.INTEGER,
      brokerage_input_percentage: Sequelize.DECIMAL(10, 4),
      brokerage_settlement_method_id: Sequelize.INTEGER,
      settlement_account_number: Sequelize.STRING(100),
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('GETDATE') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('GETDATE') }
    });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable('Brokers');
  }
};
