// Migration: Add approval fields to transactions table
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('transactions', 'approval_status', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: 'pending',
    });
    await queryInterface.addColumn('transactions', 'current_approval_level', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: 'front_office',
    });
    await queryInterface.addColumn('transactions', 'approval_chain', {
      type: Sequelize.JSON,
      allowNull: false,
      defaultValue: [],
    });
    await queryInterface.addColumn('transactions', 'submitted_by', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('transactions', 'approval_status');
    await queryInterface.removeColumn('transactions', 'current_approval_level');
    await queryInterface.removeColumn('transactions', 'approval_chain');
    await queryInterface.removeColumn('transactions', 'submitted_by');
  },
};
