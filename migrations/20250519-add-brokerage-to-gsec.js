module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('gsec', 'brokerage', {
      type: Sequelize.DECIMAL(20,6),
      allowNull: true
    });
  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('gsec', 'brokerage');
  }
};
