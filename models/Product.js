'use strict';

const mongoose = require('mongoose');
const slugify  = require('slugify');

const productSchema = new mongoose.Schema(
  {
    name: {
      type:     String,
      required: [true, 'Product name is required'],
      trim:     true,
      maxlength:[120, 'Name cannot exceed 120 characters'],
    },
    slug: {
      type:   String,
      unique: true,
      lowercase: true,
    },
    description: {
      type:     String,
      required: [true, 'Product description is required'],
      maxlength:[2000, 'Description cannot exceed 2000 characters'],
    },
    shortDescription: {
      type:     String,
      maxlength:[300, 'Short description cannot exceed 300 characters'],
    },
    flavor: {
      type:     String,
      required: [true, 'Flavor is required'],
      enum:     ['grape', 'apple_cinnamon', 'ginger', 'pineapple', 'mint'],
    },
    price: {
      type:     Number,
      required: [true, 'Price is required'],
      min:      [0, 'Price cannot be negative'],
    },
    compareAtPrice: {
      type: Number,
      min:  [0, 'Compare price cannot be negative'],
    },
    stock: {
      type:    Number,
      required:[true, 'Stock is required'],
      min:     [0, 'Stock cannot be negative'],
      default: 0,
    },
    sku: {
      type:   String,
      unique: true,
      sparse: true,
      uppercase: true,
    },
    images: [
      {
        url:      { type: String, required: true },
        publicId: { type: String, required: true }, // Cloudinary public_id for deletion
        alt:      { type: String, default: '' },
        isPrimary:{ type: Boolean, default: false },
      },
    ],
    ingredients: [
      {
        name:        { type: String, required: true },
        description: String,
        icon:        String,
      },
    ],
    tastingNotes: [String],  // e.g. ["tangy", "earthy", "wild ferment"]
    volume:       { type: Number, default: 275 },   // ml
    alcoholContent: { type: Number, default: 0.0 }, // ABV %
    isNatural:    { type: Boolean, default: true },
    isOrganic:    { type: Boolean, default: false },

    active:        { type: Boolean, default: true },
    isFeatured:    { type: Boolean, default: false },
    isNewArrival:  { type: Boolean, default: false },

    // SEO
    metaTitle:       String,
    metaDescription: String,

    // Stats (updated by order service)
    totalSold:    { type: Number, default: 0 },
    averageRating:{ type: Number, default: 0,   min: 0, max: 5 },
    reviewCount:  { type: Number, default: 0 },

    // Stripe product ID for checkout sessions
    stripeProductId: { type: String, select: false },
    stripePriceId:   { type: String, select: false },
  },
  {
    timestamps: true,
    toJSON:  { virtuals: true },
    toObject:{ virtuals: true },
  }
);

// ── Indexes ───────────────────────────────────────────────
// Note: slug and sku already indexed via unique:true in schema definitions above
productSchema.index({ flavor: 1 });
productSchema.index({ active: 1 });
productSchema.index({ isFeatured: 1 });
productSchema.index({ price: 1 });
productSchema.index({ totalSold: -1 });
productSchema.index({ createdAt: -1 });

// ── Virtuals ──────────────────────────────────────────────
productSchema.virtual('primaryImage').get(function () {
  const primary = this.images.find(img => img.isPrimary);
  return primary?.url || this.images[0]?.url || null;
});

productSchema.virtual('isInStock').get(function () {
  return this.stock > 0;
});

productSchema.virtual('discountPercent').get(function () {
  if (!this.compareAtPrice || this.compareAtPrice <= this.price) return 0;
  return Math.round(((this.compareAtPrice - this.price) / this.compareAtPrice) * 100);
});

// ── Pre-save: Auto-generate slug ──────────────────────────
productSchema.pre('save', async function (next) {
  if (!this.isModified('name')) return next();

  this.slug = slugify(this.name, { lower: true, strict: true, trim: true });

  // Ensure slug uniqueness
  const exists = await mongoose.models.Product.findOne({
    slug: this.slug,
    _id: { $ne: this._id },
  });

  if (exists) {
    this.slug = `${this.slug}-${Date.now()}`;
  }

  next();
});

module.exports = mongoose.model('Product', productSchema);
