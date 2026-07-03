'use strict';

const cloudinary      = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer          = require('multer');
const logger          = require('../utils/logger');

// ── Configure Cloudinary ──────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure:     true,
});

// ── Allowed File Types ────────────────────────────────────
const ALLOWED_FORMATS = ['jpg', 'jpeg', 'png', 'webp'];
const MAX_FILE_SIZE   = 5 * 1024 * 1024; // 5MB

// ── Product Image Storage ─────────────────────────────────
const productStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder:         `${process.env.CLOUDINARY_FOLDER || 'rebrew'}/products`,
    allowed_formats: ALLOWED_FORMATS,
    transformation: [
      { width: 1200, height: 1200, crop: 'limit', quality: 'auto:good' },
      { fetch_format: 'auto' },
    ],
  },
});

// ── Event Image Storage ───────────────────────────────────
const eventStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder:          `${process.env.CLOUDINARY_FOLDER || 'rebrew'}/events`,
    allowed_formats: ALLOWED_FORMATS,
    transformation: [
      { width: 1920, height: 1080, crop: 'fill', quality: 'auto:good' },
      { fetch_format: 'auto' },
    ],
  },
});

// ── File Filter ───────────────────────────────────────────
const fileFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPEG, PNG, and WebP images are allowed'), false);
  }
};

// ── Multer Instances ──────────────────────────────────────
const uploadProductImages = multer({
  storage:  productStorage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE, files: 5 },
});

const uploadEventImage = multer({
  storage:  eventStorage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
});

// ── Delete image from Cloudinary ──────────────────────────
const deleteImage = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    logger.info(`Cloudinary image deleted: ${publicId}`);
    return result;
  } catch (err) {
    logger.error('Cloudinary delete error:', err.message);
    throw err;
  }
};

module.exports = {
  cloudinary,
  uploadProductImages,
  uploadEventImage,
  deleteImage,
};
