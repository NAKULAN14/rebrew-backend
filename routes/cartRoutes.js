'use strict';

const router = require('express').Router();
const ctrl   = require('../controllers/cartController');
const { protect } = require('../middleware/auth');
const { validate, cartAddRules, cartUpdateRules } = require('../validators/index');

// All cart routes require authentication
router.use(protect);

router.get('/',          ctrl.getCart);
router.post('/add',      cartAddRules,    validate, ctrl.addToCart);
router.put('/update',    cartUpdateRules, validate, ctrl.updateCartItem);
router.delete('/remove', validate,        ctrl.removeFromCart);
router.delete('/clear',  ctrl.clearCart);
router.post('/validate', ctrl.validateCart);

module.exports = router;
