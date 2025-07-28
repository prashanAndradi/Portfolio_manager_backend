const express = require('express');
const router = express.Router();
const brokerController = require('../controllers/brokerController');

/**
 * @swagger
 * /brokers:
 *   post:
 *     summary: Create a new broker
 *     tags: [Brokers]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 example: 'ABC Securities'
 *               code:
 *                 type: string
 *                 example: 'ABC123'
 *     responses:
 *       201:
 *         description: Broker created
 *       400:
 *         description: Invalid input
 *
 *   get:
 *     summary: Get all brokers
 *     tags: [Brokers]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of brokers
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       401:
 *         description: Unauthorized
 */
router.post('/', brokerController.create);
router.get('/', brokerController.getAll);

/**
 * @swagger
 * /brokers/{id}:
 *   get:
 *     summary: Get broker by ID
 *     tags: [Brokers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Broker ID
 *     responses:
 *       200:
 *         description: Broker details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       404:
 *         description: Broker not found
 *
 *   put:
 *     summary: Update broker by ID
 *     tags: [Brokers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Broker ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 example: 'XYZ Securities'
 *               code:
 *                 type: string
 *                 example: 'XYZ789'
 *     responses:
 *       200:
 *         description: Broker updated
 *       404:
 *         description: Broker not found
 *
 *   delete:
 *     summary: Delete broker by ID
 *     tags: [Brokers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Broker ID
 *     responses:
 *       200:
 *         description: Broker deleted
 *       404:
 *         description: Broker not found
 */
router.get('/:id', brokerController.getById);
router.put('/:id', brokerController.update);
router.delete('/:id', brokerController.remove);

module.exports = router;
