'use strict';

const router = require('express').Router();
const ctrl   = require('../controllers/eventController');
const { protect, adminOnly } = require('../middleware/auth');
const { uploadEventImage } = require('../config/cloudinary');
const { validate, eventRules, mongoIdParam, paginationRules } = require('../validators/index');
const { query } = require('express-validator');

// ── Public list ───────────────────────────────────────────
router.get(
  '/',
  paginationRules,
  [
    query('period').optional().isIn(['upcoming','past','all']).withMessage('Must be upcoming, past, or all'),
    query('eventType').optional().isIn(['popup','festival','tasting','market','corporate','other']).withMessage('Invalid event type'),
  ],
  validate,
  ctrl.getEvents
);

// ── Admin routes — registered BEFORE /:id so 'admin' is not swallowed as an id ──
router.get('/admin/all', protect, adminOnly, paginationRules, validate, ctrl.adminGetEvents);

router.post(
  '/',
  protect,
  adminOnly,
  uploadEventImage.single('image'),
  eventRules,
  validate,
  ctrl.adminCreateEvent
);

router.put(
  '/:id',
  protect,
  adminOnly,
  mongoIdParam('id'),
  validate,
  uploadEventImage.single('image'),
  ctrl.adminUpdateEvent
);

router.delete('/:id', protect, adminOnly, mongoIdParam('id'), validate, ctrl.adminDeleteEvent);

// ── Public single event — registered LAST so /admin/all is matched first ─────
router.get('/:id', ctrl.getEvent);

module.exports = router;
