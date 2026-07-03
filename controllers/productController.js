'use strict';

const Product  = require('../models/Product');
const { AppError, sendSuccess, sendPaginated } = require('../utils/apiResponse');
const { deleteImage } = require('../config/cloudinary');
const logger   = require('../utils/logger');

// ── Helper: escape regex metacharacters — prevents ReDoS ──
// Never pass raw user input into $regex. This escapes all PCRE special chars
// so the string is matched literally. Also enforced with a length cap.
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── Helper: parse pagination from query ───────────────────
const getPagination = (query) => {
  const page  = Math.max(1, parseInt(query.page)  || 1);
  const limit = Math.min(100, parseInt(query.limit) || 12);
  const skip  = (page - 1) * limit;
  return { page, limit, skip };
};

// ── Helper: build product filter from query ───────────────
const buildFilter = (query) => {
  const filter = {};

  // Public-facing: only active products
  if (query.active !== 'all') filter.active = true;

  if (query.flavor)     filter.flavor     = query.flavor;
  if (query.featured)   filter.isFeatured = true;
  if (query.newArrival) filter.isNewArrival = true;

  // Price range
  if (query.minPrice || query.maxPrice) {
    filter.price = {};
    if (query.minPrice) filter.price.$gte = parseFloat(query.minPrice);
    if (query.maxPrice) filter.price.$lte = parseFloat(query.maxPrice);
  }

  // Text search on name / description — escaped to prevent ReDoS
  if (query.search) {
    const safe = escapeRegex(String(query.search).slice(0, 100));
    filter.$or = [
      { name:        { $regex: safe, $options: 'i' } },
      { description: { $regex: safe, $options: 'i' } },
      { flavor:      { $regex: safe, $options: 'i' } },
    ];
  }

  return filter;
};

// ── Helper: build sort from query ─────────────────────────
const buildSort = (query) => {
  const sortMap = {
    newest:     { createdAt: -1 },
    oldest:     { createdAt:  1 },
    price_asc:  { price:  1 },
    price_desc: { price: -1 },
    popular:    { totalSold: -1 },
    rating:     { averageRating: -1 },
  };
  return sortMap[query.sort] || sortMap.newest;
};

/* ─────────────────────────────────────────────────────────
   GET /products
   Public — paginated, filterable, searchable
───────────────────────────────────────────────────────── */
exports.getAllProducts = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req.query);
    const filter = buildFilter(req.query);
    const sort   = buildSort(req.query);

    const [products, total] = await Promise.all([
      Product.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .select('-stripeProductId -stripePriceId')
        .lean(),
      Product.countDocuments(filter),
    ]);

    return sendPaginated(res, { data: products, total, page, limit, message: 'Products fetched.' });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   GET /products/:id
   Public — by MongoDB ID or slug
───────────────────────────────────────────────────────── */
exports.getProduct = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Support lookup by both Mongo ID and slug
    const isMongoId = /^[a-f\d]{24}$/i.test(id);
    const query     = isMongoId ? { _id: id } : { slug: id };

    const product = await Product.findOne({ ...query, active: true })
      .select('-stripeProductId -stripePriceId')
      .lean();

    if (!product) return next(new AppError('Product not found.', 404));

    return sendSuccess(res, { message: 'Product fetched.', data: { product } });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   POST /admin/products
   Admin only — create product
───────────────────────────────────────────────────────── */
exports.createProduct = async (req, res, next) => {
  try {
    const {
      name, description, shortDescription, flavor, price, compareAtPrice,
      stock, sku, ingredients, tastingNotes, volume, isNatural, isOrganic,
      isFeatured, isNewArrival, metaTitle, metaDescription,
    } = req.body;

    // Process uploaded images from Cloudinary (via multer middleware)
    const images = [];
    if (req.files?.length) {
      req.files.forEach((file, index) => {
        images.push({
          url:       file.path,        // Cloudinary URL
          publicId:  file.filename,    // Cloudinary public_id
          alt:       `${name} - Image ${index + 1}`,
          isPrimary: index === 0,      // First image is primary
        });
      });
    }

    const product = await Product.create({
      name, description, shortDescription, flavor, price, compareAtPrice,
      stock, sku: sku?.toUpperCase(), ingredients, tastingNotes, volume,
      isNatural, isOrganic, isFeatured, isNewArrival,
      metaTitle, metaDescription, images,
    });

    logger.info(`Product created: ${product.name} [${product._id}] by admin ${req.user._id}`);

    return sendSuccess(res, {
      statusCode: 201,
      message:    'Product created successfully.',
      data:       { product },
    });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   PUT /admin/products/:id
   Admin only — update product
───────────────────────────────────────────────────────── */
exports.updateProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return next(new AppError('Product not found.', 404));

    // Whitelist updatable fields
    const allowedFields = [
      'name', 'description', 'shortDescription', 'flavor', 'price',
      'compareAtPrice', 'stock', 'sku', 'ingredients', 'tastingNotes',
      'volume', 'isNatural', 'isOrganic', 'isFeatured', 'isNewArrival',
      'active', 'metaTitle', 'metaDescription',
    ];

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        product[field] = req.body[field];
      }
    });

    // Handle new image uploads
    if (req.files?.length) {
      const newImages = req.files.map((file, index) => ({
        url:       file.path,
        publicId:  file.filename,
        alt:       `${product.name} - Image ${product.images.length + index + 1}`,
        isPrimary: product.images.length === 0 && index === 0,
      }));
      product.images.push(...newImages);
    }

    await product.save();

    logger.info(`Product updated: ${product.name} [${product._id}] by admin ${req.user._id}`);

    return sendSuccess(res, { message: 'Product updated.', data: { product } });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   DELETE /admin/products/:id/images/:imageId
   Admin only — remove a single image
───────────────────────────────────────────────────────── */
exports.deleteProductImage = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return next(new AppError('Product not found.', 404));

    const imageIndex = product.images.findIndex(
      img => img._id.toString() === req.params.imageId
    );
    if (imageIndex === -1) return next(new AppError('Image not found.', 404));

    const [removed] = product.images.splice(imageIndex, 1);

    // Delete from Cloudinary
    if (removed.publicId) {
      await deleteImage(removed.publicId).catch(err =>
        logger.error('Cloudinary delete failed:', err.message)
      );
    }

    // Reassign primary if we removed it
    if (removed.isPrimary && product.images.length > 0) {
      product.images[0].isPrimary = true;
    }

    await product.save();

    return sendSuccess(res, { message: 'Image deleted.', data: { product } });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   DELETE /admin/products/:id
   Admin only — soft delete (deactivate)
───────────────────────────────────────────────────────── */
exports.deleteProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return next(new AppError('Product not found.', 404));

    // Soft delete — never permanently delete products with order history
    product.active = false;
    await product.save();

    logger.info(`Product deactivated: ${product.name} [${product._id}] by admin ${req.user._id}`);

    return sendSuccess(res, { message: 'Product deactivated.' });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   PUT /admin/products/:id/stock
   Admin only — update stock level
───────────────────────────────────────────────────────── */
exports.updateStock = async (req, res, next) => {
  try {
    const { stock, operation } = req.body;
    // operation: 'set' | 'increment' | 'decrement'

    const product = await Product.findById(req.params.id);
    if (!product) return next(new AppError('Product not found.', 404));

    if (operation === 'increment') {
      product.stock += parseInt(stock);
    } else if (operation === 'decrement') {
      product.stock = Math.max(0, product.stock - parseInt(stock));
    } else {
      product.stock = parseInt(stock);
    }

    await product.save();

    logger.info(`Stock updated: ${product.name} → ${product.stock} units`);

    return sendSuccess(res, {
      message: 'Stock updated.',
      data:    { productId: product._id, stock: product.stock },
    });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   GET /products/featured
   Public — featured products for homepage
───────────────────────────────────────────────────────── */
exports.getFeaturedProducts = async (req, res, next) => {
  try {
    const products = await Product.find({ active: true, isFeatured: true })
      .sort({ totalSold: -1 })
      .limit(6)
      .select('-stripeProductId -stripePriceId')
      .lean();

    return sendSuccess(res, { message: 'Featured products fetched.', data: { products } });
  } catch (err) {
    next(err);
  }
};
