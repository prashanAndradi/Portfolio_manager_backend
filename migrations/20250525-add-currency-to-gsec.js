module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('gsec', 'currency', {
      type: Sequelize.STRING(10),
      defaultValue: 'LKR',
      allowNull: false
    });
  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('gsec', 'currency');
  }
};
