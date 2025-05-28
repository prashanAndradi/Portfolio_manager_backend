module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('gsec', 'portfolio', { type: Sequelize.STRING });
    await queryInterface.addColumn('gsec', 'strategy', { type: Sequelize.STRING });
    await queryInterface.addColumn('gsec', 'broker', { type: Sequelize.STRING });
    await queryInterface.addColumn('gsec', 'accrued_interest_adjustment', { type: Sequelize.DECIMAL(20,6), defaultValue: 0 });
    await queryInterface.addColumn('gsec', 'clean_price_adjustment', { type: Sequelize.DECIMAL(20,6), defaultValue: 0 });
  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('gsec', 'portfolio');
    await queryInterface.removeColumn('gsec', 'strategy');
    await queryInterface.removeColumn('gsec', 'broker');
    await queryInterface.removeColumn('gsec', 'accrued_interest_adjustment');
    await queryInterface.removeColumn('gsec', 'clean_price_adjustment');
  }
};
