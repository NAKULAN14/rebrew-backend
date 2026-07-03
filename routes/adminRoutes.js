'use strict';

const router = require('express').Router();
const ctrl   = require('../controllers/adminController');
const { protect, adminOnly } = require('../middleware/auth');
const { validate, mongoIdParam, paginationRules } = require('../validators/index');
const { body, query } = require('express-validator');

// All admin routes: must be authenticated + admin role
router.use(protect, adminOnly);

// ── Dashboard ─────────────────────────────────────────────
router.get('/dashboard', ctrl.getDashboardStats);

// ── Analytics ─────────────────────────────────────────────
router.get(
  '/analytics/sales',
  [
    query('period')
      .optional()
      .isIn(['7d', '30d', '12m'])
      .withMessage('Period must be 7d, 30d, or 12m'),
  ],
  validate,
  ctrl.getSalesAnalytics
);

router.get('/analytics/inventory', ctrl.getInventoryAnalytics);

// ── Users ─────────────────────────────────────────────────
router.get(
  '/users',
  paginationRules,
  [
    query('role').optional().isIn(['customer', 'admin', 'vendor']).withMessage('Invalid role'),
    query('active').optional().isBoolean().withMessage('Active must be boolean'),
    query('sortBy').optional().isIn(['createdAt', 'name', 'email', 'loginCount']).withMessage('Invalid sort field'),
    query('order').optional().isIn(['asc', 'desc']).withMessage('Order must be asc or desc'),
  ],
  validate,
  ctrl.getUsers
);

router.get(
  '/users/:id',
  mongoIdParam('id'),
  validate,
  ctrl.getUser
);

router.put(
  '/users/:id',
  mongoIdParam('id'),
  [
    body('role')
      .optional()
      .isIn(['customer', 'admin', 'vendor'])
      .withMessage('Invalid role'),
    body('isActive')
      .optional()
      .isBoolean()
      .withMessage('isActive must be boolean'),
    body('isEmailVerified')
      .optional()
      .isBoolean()
      .withMessage('isEmailVerified must be boolean'),
  ],
  validate,
  ctrl.updateUser
);

router.delete(
  '/users/:id',
  mongoIdParam('id'),
  validate,
  ctrl.deleteUser
);

// ── Reviews ───────────────────────────────────────────────
router.get(
  '/reviews',
  paginationRules,
  [
    query('isApproved').optional().isBoolean().withMessage('isApproved must be boolean'),
    query('rating').optional().isInt({ min: 1, max: 5 }).withMessage('Rating must be 1–5'),
  ],
  validate,
  ctrl.getReviews
);

router.put(
  '/reviews/:id',
  mongoIdParam('id'),
  [
    body('isApproved').notEmpty().isBoolean().withMessage('isApproved (boolean) is required'),
    body('adminNote').optional().isLength({ max: 500 }).withMessage('Note too long'),
  ],
  validate,
  ctrl.updateReview
);

router.delete(
  '/reviews/:id',
  mongoIdParam('id'),
  validate,
  ctrl.deleteReview
);

module.exports = router;
