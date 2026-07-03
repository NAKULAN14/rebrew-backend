'use strict';

const router = require('express').Router();
const ctrl   = require('../controllers/vendorController');
const { protect, adminOnly } = require('../middleware/auth');
const { contactLimiter } = require('../middleware/rateLimiter');
const { validate, vendorApplyRules, mongoIdParam, paginationRules } = require('../validators/index');
const { body } = require('express-validator');

// ── Public ────────────────────────────────────────────────
router.post(
  '/apply',
  contactLimiter,
  vendorApplyRules,
  [
    body('businessType')
      .optional()
      .isIn(['cafe', 'restaurant', 'hotel', 'retail_store', 'supermarket', 'event_company', 'online_store', 'other'])
      .withMessage('Invalid business type'),
    body('estimatedMonthlyVolume')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Monthly volume must be a positive integer'),
    body('notes')
      .optional()
      .isLength({ max: 2000 })
      .withMessage('Notes cannot exceed 2000 characters'),
  ],
  validate,
  ctrl.applyAsVendor
);

// ── Admin only ────────────────────────────────────────────
router.use(protect, adminOnly);

router.get('/', paginationRules, validate, ctrl.adminGetVendors);

router.get(
  '/:id',
  mongoIdParam('id'),
  validate,
  ctrl.adminGetVendor
);

router.put(
  '/:id',
  mongoIdParam('id'),
  [
    body('status')
      .optional()
      .isIn(['new', 'contacted', 'in_discussion', 'approved', 'rejected', 'onboarded'])
      .withMessage('Invalid vendor status'),
    body('adminNote')
      .optional()
      .isLength({ max: 1000 })
      .withMessage('Admin note cannot exceed 1000 characters'),
    body('assignedTo')
      .optional()
      .isMongoId()
      .withMessage('Invalid assignedTo user ID'),
  ],
  validate,
  ctrl.adminUpdateVendor
);

router.delete(
  '/:id',
  mongoIdParam('id'),
  validate,
  ctrl.adminDeleteVendor
);

module.exports = router;
