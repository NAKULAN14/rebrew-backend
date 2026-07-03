'use strict';

const router = require('express').Router();
const ctrl   = require('../controllers/productController');
const { protect, adminOnly } = require('../middleware/auth');
const { uploadProductImages } = require('../config/cloudinary');
const {
  validate,
  productRules,
  productIdParam,
  paginationRules,
  mongoIdParam,
} = require('../validators/index');
const { body } = require('express-validator');

// ── Public ────────────────────────────────────────────────
router.get('/featured',          ctrl.getFeaturedProducts);
router.get('/',                  paginationRules, validate, ctrl.getAllProducts);
router.get('/:id',               ctrl.getProduct);

// ── Admin only ────────────────────────────────────────────
router.use(protect, adminOnly);

router.post(
  '/',
  uploadProductImages.array('images', 5),
  productRules,
  validate,
  ctrl.createProduct
);

router.put(
  '/:id',
  productIdParam,
  validate,
  uploadProductImages.array('images', 5),
  ctrl.updateProduct
);

router.put(
  '/:id/stock',
  productIdParam,
  [
    body('stock').notEmpty().isInt({ min: 0 }).withMessage('Stock must be a non-negative integer'),
    body('operation').optional().isIn(['set', 'increment', 'decrement']).withMessage('Invalid operation'),
  ],
  validate,
  ctrl.updateStock
);

router.delete(
  '/:id/images/:imageId',
  mongoIdParam('id'),
  mongoIdParam('imageId'),
  validate,
  ctrl.deleteProductImage
);

router.delete(
  '/:id',
  productIdParam,
  validate,
  ctrl.deleteProduct
);

module.exports = router;
