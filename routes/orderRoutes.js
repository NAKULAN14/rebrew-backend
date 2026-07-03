'use strict';

const router = require('express').Router();
const ctrl   = require('../controllers/orderController');
const { protect, adminOnly } = require('../middleware/auth');
const { validate, createOrderRules, mongoIdParam, paginationRules } = require('../validators/index');
const { body } = require('express-validator');

router.use(protect);

// ── Admin routes FIRST — must precede /:id or Express matches 'admin' as an id ──
router.get('/admin/all',   adminOnly, paginationRules, validate, ctrl.adminGetAllOrders);
router.get('/admin/stats', adminOnly, ctrl.adminGetOrderStats);
router.get('/admin/:id',   adminOnly, mongoIdParam('id'), validate, ctrl.adminGetOrder);
router.put(
  '/admin/:id',
  adminOnly,
  mongoIdParam('id'),
  [
    body('orderStatus')
      .optional()
      .isIn(['pending','confirmed','processing','packed','shipped','delivered','cancelled','returned'])
      .withMessage('Invalid order status'),
    body('paymentStatus')
      .optional()
      .isIn(['pending','paid','failed','refunded','partially_refunded'])
      .withMessage('Invalid payment status'),
    body('trackingNumber').optional().isLength({ max: 100 }).withMessage('Tracking number too long'),
    body('adminNote').optional().isLength({ max: 500 }).withMessage('Note cannot exceed 500 characters'),
  ],
  validate,
  ctrl.adminUpdateOrder
);

// ── Customer routes ───────────────────────────────────────
router.post(
  '/',
  createOrderRules,
  [
    body('paymentMethod').optional().isIn(['card','upi','wallet']).withMessage('Invalid payment method'),
    body('customerNote').optional().isLength({ max: 500 }).withMessage('Note cannot exceed 500 characters'),
  ],
  validate,
  ctrl.createOrder
);

router.get('/', paginationRules, validate, ctrl.getMyOrders);

router.get('/:id', mongoIdParam('id'), validate, ctrl.getOrder);

router.put(
  '/:id/cancel',
  mongoIdParam('id'),
  [body('reason').optional().isLength({ max: 300 }).withMessage('Reason cannot exceed 300 characters')],
  validate,
  ctrl.cancelOrder
);

module.exports = router;
