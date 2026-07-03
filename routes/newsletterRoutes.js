'use strict';

const router = require('express').Router();
const ctrl   = require('../controllers/newsletterController');
const { protect, adminOnly } = require('../middleware/auth');
const { contactLimiter } = require('../middleware/rateLimiter');
const { validate, newsletterRules, mongoIdParam, paginationRules } = require('../validators/index');
const { body } = require('express-validator');

// ── Public ────────────────────────────────────────────────
router.post(
  '/',
  contactLimiter,
  newsletterRules,
  [
    body('name').optional().trim().isLength({ max: 80 }).withMessage('Name too long'),
    body('source').optional().isIn(['website', 'checkout', 'event']).withMessage('Invalid source'),
  ],
  validate,
  ctrl.subscribe
);

router.post(
  '/unsubscribe',
  [
    body('token').notEmpty().withMessage('Unsubscribe token is required'),
  ],
  validate,
  ctrl.unsubscribe
);

// ── Admin only ────────────────────────────────────────────
router.use(protect, adminOnly);

router.get('/', paginationRules, validate, ctrl.adminGetSubscribers);

router.post(
  '/broadcast',
  [
    body('subject')
      .notEmpty().withMessage('Subject is required')
      .isLength({ max: 200 }).withMessage('Subject cannot exceed 200 characters'),
    body('htmlContent')
      .notEmpty().withMessage('HTML content is required'),
    body('tags').optional().isArray().withMessage('Tags must be an array'),
  ],
  validate,
  ctrl.adminBroadcast
);

router.delete(
  '/:id',
  mongoIdParam('id'),
  validate,
  ctrl.adminDeleteSubscriber
);

module.exports = router;
