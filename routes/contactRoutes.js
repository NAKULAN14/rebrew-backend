'use strict';

const router = require('express').Router();
const ctrl   = require('../controllers/contactController');
const { protect, adminOnly } = require('../middleware/auth');
const { contactLimiter } = require('../middleware/rateLimiter');
const { validate, contactRules, mongoIdParam, paginationRules } = require('../validators/index');
const { body } = require('express-validator');

// ── Public ────────────────────────────────────────────────
router.post(
  '/',
  contactLimiter,
  contactRules,
  validate,
  ctrl.submitContact
);

// ── Admin only ────────────────────────────────────────────
router.use(protect, adminOnly);

router.get('/', paginationRules, validate, ctrl.adminGetContacts);

router.get(
  '/:id',
  mongoIdParam('id'),
  validate,
  ctrl.adminGetContact
);

router.put(
  '/:id',
  mongoIdParam('id'),
  [
    body('status')
      .optional()
      .isIn(['new', 'read', 'replied', 'closed'])
      .withMessage('Invalid status'),
    body('adminNote')
      .optional()
      .isLength({ max: 1000 })
      .withMessage('Admin note cannot exceed 1000 characters'),
  ],
  validate,
  ctrl.adminUpdateContact
);

router.delete(
  '/:id',
  mongoIdParam('id'),
  validate,
  ctrl.adminDeleteContact
);

module.exports = router;
