'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/paymentController');
const { protect, adminOnly } = require('../middleware/auth');
const { paymentLimiter }     = require('../middleware/rateLimiter');
const { validate, mongoIdParam, createOrderRules } = require('../validators/index');
const { body } = require('express-validator');

// ── All routes require auth ───────────────────────────────
router.use(protect);

// ── POST /payments/create-order ───────────────────────────
// Creates a Razorpay order + pending MongoDB order.
// Returns razorpay_order_id + key_id for the frontend modal.
router.post(
  '/create-order',
  paymentLimiter,
  createOrderRules,
  [
    body('customerNote')
      .optional()
      .isLength({ max: 500 })
      .withMessage('Note cannot exceed 500 characters'),
  ],
  validate,
  ctrl.createOrder
);

// ── POST /payments/verify ─────────────────────────────────
// Verifies HMAC-SHA256 signature after Razorpay modal completes.
// This is the ONLY place an order becomes paymentStatus: 'paid'.
router.post(
  '/verify',
  paymentLimiter,
  [
    body('razorpay_order_id')
      .notEmpty().withMessage('razorpay_order_id is required'),
    body('razorpay_payment_id')
      .notEmpty().withMessage('razorpay_payment_id is required'),
    body('razorpay_signature')
      .notEmpty().withMessage('razorpay_signature is required'),
  ],
  validate,
  ctrl.verifyPayment
);

// ── POST /payments/webhook ────────────────────────────────
// Razorpay sends standard JSON — no raw body special handling needed.
// Open this route publicly (no protect) — Razorpay can't auth as a user.
// Security comes from X-Razorpay-Signature header verification in controller.
router.post('/webhook', ctrl.handleWebhook);

// ── POST /payments/refund/:orderId ────────────────────────
// Admin-only: issue full or partial refund via Razorpay API.
router.post(
  '/refund/:orderId',
  adminOnly,
  mongoIdParam('orderId'),
  [
    body('amount')
      .optional()
      .isFloat({ min: 1 })
      .withMessage('Refund amount must be a positive number'),
    body('reason')
      .optional()
      .isString()
      .isLength({ max: 200 })
      .withMessage('Reason cannot exceed 200 characters'),
  ],
  validate,
  ctrl.adminRefundOrder
);

module.exports = router;
