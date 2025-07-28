const express = require('express');
const { getAllUsers, updateUserTabs } = require('../controllers/userController');
const router = express.Router();

/**
 * @swagger
 * /users:
 *   get:
 *     summary: Get all users
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of users
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       401:
 *         description: Unauthorized
 */
router.get('/', getAllUsers);

/**
 * @swagger
 * /users/{id}/tabs:
 *   put:
 *     summary: Update user tabs
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: User ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tabs:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["dashboard", "transactions"]
 *     responses:
 *       200:
 *         description: User tabs updated
 *       404:
 *         description: User not found
 */
router.put('/:id/tabs', updateUserTabs);

module.exports = router;
