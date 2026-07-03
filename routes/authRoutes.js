'use strict';

const router = require('express').Router();
const ctrl   = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const { authLimiter, passwordResetLimiter } = require('../middleware/rateLimiter');
const {
  validate,
  registerRules,
  loginRules,
  forgotPasswordRules,
  resetPasswordRules,
  updatePasswordRules,
  mongoIdParam,
} = require('../validators/index');

// ── Public ────────────────────────────────────────────────
router.post('/register',       authLimiter, registerRules,       validate, ctrl.register);
router.post('/login',          authLimiter, loginRules,          validate, ctrl.login);
router.post('/logout',         protect, ctrl.logout);
router.post('/refresh-token',  ctrl.refreshToken);
router.post('/forgot-password',passwordResetLimiter, forgotPasswordRules, validate, ctrl.forgotPassword);
router.post('/reset-password', passwordResetLimiter, resetPasswordRules,  validate, ctrl.resetPassword);

// ── Protected ─────────────────────────────────────────────
router.use(protect);

router.get ('/profile',         ctrl.getProfile);
router.put ('/profile',         ctrl.updateProfile);
router.put ('/update-password', updatePasswordRules, validate, ctrl.updatePassword);
router.post('/addresses',       ctrl.addAddress);
router.delete('/addresses/:addressId', mongoIdParam('addressId'), validate, ctrl.removeAddress);

module.exports = router;
