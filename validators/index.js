'use strict';

const { body, param, query, validationResult } = require('express-validator');

// ── Validation result handler middleware ──────────────────
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      success: false,
      message: 'Validation failed',
      errors:  errors.array().map(e => ({ field: e.path, message: e.msg })),
    });
  }
  next();
};

/* ============================================================
   AUTH VALIDATORS
   ============================================================ */

const registerRules = [
  body('name')
    .trim()
    .notEmpty().withMessage('Name is required')
    .isLength({ min: 2, max: 80 }).withMessage('Name must be 2–80 characters')
    .matches(/^[a-zA-Z\s.'-]+$/).withMessage('Name contains invalid characters'),

  body('email')
    .trim()
    .toLowerCase()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please provide a valid email address')
    .normalizeEmail(),

  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage(
      'Password must contain at least one uppercase letter, one lowercase letter, and one number'
    ),

  body('phone')
    .optional({ nullable: true })
    .trim()
    .isMobilePhone('any', { strictMode: false }).withMessage('Please provide a valid phone number'),
];

const loginRules = [
  body('email')
    .trim()
    .toLowerCase()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please provide a valid email address')
    .normalizeEmail(),

  body('password')
    .notEmpty().withMessage('Password is required'),
];

const forgotPasswordRules = [
  body('email')
    .trim()
    .toLowerCase()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please provide a valid email address')
    .normalizeEmail(),
];

const resetPasswordRules = [
  body('token')
    .notEmpty().withMessage('Reset token is required'),

  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage(
      'Password must contain at least one uppercase letter, one lowercase letter, and one number'
    ),
];

const updatePasswordRules = [
  body('currentPassword')
    .notEmpty().withMessage('Current password is required'),

  body('newPassword')
    .notEmpty().withMessage('New password is required')
    .isLength({ min: 8 }).withMessage('New password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage(
      'Password must contain uppercase, lowercase, and a number'
    ),
];

/* ============================================================
   PRODUCT VALIDATORS
   ============================================================ */

const productRules = [
  body('name')
    .trim()
    .notEmpty().withMessage('Product name is required')
    .isLength({ max: 120 }).withMessage('Name cannot exceed 120 characters'),

  body('description')
    .trim()
    .notEmpty().withMessage('Description is required')
    .isLength({ max: 2000 }).withMessage('Description cannot exceed 2000 characters'),

  body('flavor')
    .notEmpty().withMessage('Flavor is required')
    .isIn(['grape', 'apple_cinnamon', 'ginger', 'pineapple', 'mint'])
    .withMessage('Invalid flavor. Must be one of: grape, apple_cinnamon, ginger, pineapple, mint'),

  body('price')
    .notEmpty().withMessage('Price is required')
    .isFloat({ min: 0 }).withMessage('Price must be a positive number'),

  body('stock')
    .notEmpty().withMessage('Stock is required')
    .isInt({ min: 0 }).withMessage('Stock must be a non-negative integer'),
];

const productIdParam = [
  param('id')
    .isMongoId().withMessage('Invalid product ID format'),
];

/* ============================================================
   ORDER VALIDATORS
   ============================================================ */

const createOrderRules = [
  body('shippingAddress.fullName')
    .trim().notEmpty().withMessage('Full name is required'),
  body('shippingAddress.line1')
    .trim().notEmpty().withMessage('Address line 1 is required'),
  body('shippingAddress.city')
    .trim().notEmpty().withMessage('City is required'),
  body('shippingAddress.state')
    .trim().notEmpty().withMessage('State is required'),
  body('shippingAddress.pincode')
    .trim().notEmpty().withMessage('PIN code is required')
    .isLength({ min: 6, max: 6 }).withMessage('PIN code must be 6 digits')
    .isNumeric().withMessage('PIN code must contain only numbers'),
  body('shippingAddress.phone')
    .trim().notEmpty().withMessage('Phone is required')
    .isMobilePhone('any').withMessage('Invalid phone number'),
];

/* ============================================================
   CART VALIDATORS
   ============================================================ */

const cartAddRules = [
  body('productId')
    .notEmpty().withMessage('Product ID is required')
    .isMongoId().withMessage('Invalid product ID'),

  body('quantity')
    .notEmpty().withMessage('Quantity is required')
    .isInt({ min: 1, max: 99 }).withMessage('Quantity must be between 1 and 99'),
];

const cartUpdateRules = [
  body('productId')
    .notEmpty().withMessage('Product ID is required')
    .isMongoId().withMessage('Invalid product ID'),

  body('quantity')
    .notEmpty().withMessage('Quantity is required')
    .isInt({ min: 0, max: 99 }).withMessage('Quantity must be between 0 and 99'),
];

/* ============================================================
   CONTACT VALIDATORS
   ============================================================ */

const contactRules = [
  body('name')
    .trim().notEmpty().withMessage('Name is required')
    .isLength({ max: 120 }).withMessage('Name cannot exceed 120 characters'),

  body('email')
    .trim().toLowerCase().normalizeEmail()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please provide a valid email address'),

  body('message')
    .trim().notEmpty().withMessage('Message is required')
    .isLength({ min: 10, max: 2000 }).withMessage('Message must be 10–2000 characters'),

  body('enquiryType')
    .optional()
    .isIn(['general', 'wholesale', 'retail', 'event', 'press', 'investor', 'order_issue', 'other'])
    .withMessage('Invalid enquiry type'),
];

/* ============================================================
   NEWSLETTER VALIDATORS
   ============================================================ */

const newsletterRules = [
  body('email')
    .trim().toLowerCase().normalizeEmail()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please provide a valid email address'),
];

/* ============================================================
   VENDOR VALIDATORS
   ============================================================ */

const vendorApplyRules = [
  body('businessName')
    .trim().notEmpty().withMessage('Business name is required')
    .isLength({ max: 200 }).withMessage('Business name cannot exceed 200 characters'),

  body('contactPerson')
    .trim().notEmpty().withMessage('Contact person name is required'),

  body('email')
    .trim().toLowerCase().normalizeEmail()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please provide a valid email address'),

  body('phone')
    .trim().notEmpty().withMessage('Phone number is required')
    .isMobilePhone('any').withMessage('Invalid phone number'),

  body('location.city')
    .trim().notEmpty().withMessage('City is required'),
];

/* ============================================================
   EVENT VALIDATORS
   ============================================================ */

const eventRules = [
  body('title')
    .trim().notEmpty().withMessage('Event title is required')
    .isLength({ max: 200 }).withMessage('Title cannot exceed 200 characters'),

  body('location.venue')
    .trim().notEmpty().withMessage('Venue is required'),

  body('location.city')
    .trim().notEmpty().withMessage('City is required'),

  body('date')
    .notEmpty().withMessage('Event date is required')
    .isISO8601().withMessage('Date must be a valid ISO 8601 date'),
];

/* ============================================================
   PAGINATION VALIDATORS
   ============================================================ */

const paginationRules = [
  query('page')
    .optional()
    .isInt({ min: 1 }).withMessage('Page must be a positive integer')
    .toInt(),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
    .toInt(),
];

/* ============================================================
   MONGO ID PARAM
   ============================================================ */

const mongoIdParam = (paramName = 'id') => [
  param(paramName)
    .isMongoId().withMessage(`Invalid ${paramName} format`),
];

module.exports = {
  validate,
  // Auth
  registerRules,
  loginRules,
  forgotPasswordRules,
  resetPasswordRules,
  updatePasswordRules,
  // Product
  productRules,
  productIdParam,
  // Order
  createOrderRules,
  // Cart
  cartAddRules,
  cartUpdateRules,
  // Contact
  contactRules,
  // Newsletter
  newsletterRules,
  // Vendor
  vendorApplyRules,
  // Event
  eventRules,
  // Pagination
  paginationRules,
  // Mongo ID
  mongoIdParam,
};
