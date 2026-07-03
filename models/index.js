'use strict';

// ── This file exports all secondary models ────────────────
// Import individually where needed.

const mongoose = require('mongoose');

/* ============================================================
   CART MODEL
   ============================================================ */
const cartItemSchema = new mongoose.Schema(
  {
    product:  { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 1, max: 99 },
    price:    { type: Number, required: true }, // Snapshot — re-validated on checkout
  },
  { _id: false }
);

const cartSchema = new mongoose.Schema(
  {
    user:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    items:     [cartItemSchema],
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Note: Cart.user already indexed via unique:true in schema definition above

cartSchema.virtual('total').get(function () {
  return this.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
});

cartSchema.virtual('itemCount').get(function () {
  return this.items.reduce((sum, item) => sum + item.quantity, 0);
});

cartSchema.set('toJSON',   { virtuals: true });
cartSchema.set('toObject', { virtuals: true });

const Cart = mongoose.model('Cart', cartSchema);


/* ============================================================
   CONTACT MODEL
   ============================================================ */
const contactSchema = new mongoose.Schema(
  {
    name:         { type: String, required: true, trim: true, maxlength: 120 },
    email:        { type: String, required: true, lowercase: true, trim: true },
    phone:        { type: String, trim: true },
    organisation: { type: String, trim: true, maxlength: 200 },
    enquiryType:  {
      type:    String,
      enum:    ['general', 'wholesale', 'retail', 'event', 'press', 'investor', 'order_issue', 'other'],
      default: 'general',
    },
    message:   { type: String, required: true, maxlength: 2000 },
    status:    { type: String, enum: ['new', 'read', 'replied', 'closed'], default: 'new' },
    adminNote: { type: String, maxlength: 1000 },
    repliedAt: Date,
    ipAddress: String,
  },
  { timestamps: true }
);

contactSchema.index({ email: 1 });
contactSchema.index({ status: 1 });
contactSchema.index({ createdAt: -1 });

const Contact = mongoose.model('Contact', contactSchema);


/* ============================================================
   NEWSLETTER SUBSCRIBER MODEL
   ============================================================ */
const newsletterSchema = new mongoose.Schema(
  {
    email: {
      type:     String,
      required: true,
      unique:   true,
      lowercase:true,
      trim:     true,
    },
    name:     { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    source:   { type: String, enum: ['website', 'checkout', 'event', 'admin'], default: 'website' },
    unsubscribedAt: Date,
    unsubscribeToken: { type: String, select: false },
    ipAddress:        { type: String, select: false },
    tags: [String],
  },
  { timestamps: true }
);

// Note: email already indexed via unique:true in schema definition above
newsletterSchema.index({ isActive: 1 });
newsletterSchema.index({ createdAt: -1 });

const Newsletter = mongoose.model('Newsletter', newsletterSchema);


/* ============================================================
   VENDOR / WHOLESALE INQUIRY MODEL
   ============================================================ */
const vendorSchema = new mongoose.Schema(
  {
    businessName:   { type: String, required: true, trim: true, maxlength: 200 },
    contactPerson:  { type: String, required: true, trim: true, maxlength: 120 },
    email:          { type: String, required: true, lowercase: true, trim: true },
    phone:          { type: String, required: true, trim: true },
    businessType:   {
      type: String,
      enum: ['cafe', 'restaurant', 'hotel', 'retail_store', 'supermarket', 'event_company', 'online_store', 'other'],
    },
    location: {
      city:    { type: String, trim: true },
      state:   { type: String, trim: true },
      pincode: { type: String, trim: true },
    },
    estimatedMonthlyVolume: Number, // bottles/month
    currentBrands: String, // what drinks they currently stock
    notes:          { type: String, maxlength: 2000 },
    status: {
      type:    String,
      enum:    ['new', 'contacted', 'in_discussion', 'approved', 'rejected', 'onboarded'],
      default: 'new',
    },
    adminNote:  { type: String, maxlength: 1000 },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    ipAddress:  { type: String, select: false },
  },
  { timestamps: true }
);

vendorSchema.index({ email: 1 });
vendorSchema.index({ status: 1 });
vendorSchema.index({ createdAt: -1 });

const Vendor = mongoose.model('Vendor', vendorSchema);


/* ============================================================
   EVENT MODEL
   ============================================================ */
const eventSchema = new mongoose.Schema(
  {
    title: {
      type:     String,
      required: [true, 'Event title is required'],
      trim:     true,
      maxlength:[200, 'Title cannot exceed 200 characters'],
    },
    slug: { type: String, unique: true, lowercase: true },
    description: { type: String, maxlength: 3000 },
    location: {
      venue:   { type: String, required: true },
      city:    { type: String, required: true },
      state:   String,
      address: String,
      mapLink: String,
    },
    date:    { type: Date, required: [true, 'Event date is required'] },
    endDate: Date,
    time:    String, // e.g. "10:00 AM – 6:00 PM"
    image: {
      url:      String,
      publicId: String,
      alt:      String,
    },
    eventType: {
      type: String,
      enum: ['popup', 'festival', 'tasting', 'market', 'corporate', 'other'],
      default: 'popup',
    },
    entryFee:   { type: Number, default: 0 },
    isFeatured: { type: Boolean, default: false },
    isPublished:{ type: Boolean, default: true },
    rsvpLink:   String,
    tags:       [String],
  },
  {
    timestamps: true,
    toJSON:  { virtuals: true },
    toObject:{ virtuals: true },
  }
);

eventSchema.index({ date: 1 });
eventSchema.index({ isPublished: 1 });
eventSchema.index({ isFeatured: 1 });

eventSchema.virtual('isPast').get(function () {
  return this.date < new Date();
});

eventSchema.virtual('isUpcoming').get(function () {
  return this.date >= new Date();
});

// Auto-generate slug
eventSchema.pre('save', async function (next) {
  if (!this.isModified('title')) return next();
  const slugify = require('slugify');
  this.slug = slugify(this.title, { lower: true, strict: true });
  const exists = await mongoose.models.Event.findOne({ slug: this.slug, _id: { $ne: this._id } });
  if (exists) this.slug = `${this.slug}-${Date.now()}`;
  next();
});

const Event = mongoose.model('Event', eventSchema);


/* ============================================================
   REVIEW MODEL
   ============================================================ */
const reviewSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    user:    { type: mongoose.Schema.Types.ObjectId, ref: 'User',    required: true },
    order:   { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    rating:  { type: Number, required: true, min: 1, max: 5 },
    title:   { type: String, trim: true, maxlength: 120 },
    body:    { type: String, required: true, maxlength: 2000 },
    flavor:  String,
    isVerifiedPurchase: { type: Boolean, default: false },
    isApproved: { type: Boolean, default: false },
    helpfulCount: { type: Number, default: 0 },
    adminNote: String,
  },
  { timestamps: true }
);

reviewSchema.index({ product: 1, user: 1 }, { unique: true }); // One review per product per user
reviewSchema.index({ product: 1, isApproved: 1 });
reviewSchema.index({ user: 1 });

// Update product averageRating after save/delete
reviewSchema.post('save', async function () {
  await updateProductRating(this.product);
});

// Fix: use 'findOneAndDelete' query middleware — fires on findByIdAndDelete
// The previous { document: true } hook only fired on doc.deleteOne(), not findByIdAndDelete
reviewSchema.post('findOneAndDelete', async function (doc) {
  if (doc) await updateProductRating(doc.product);
});

async function updateProductRating(productId) {
  const Product = mongoose.model('Product');
  const stats   = await mongoose.model('Review').aggregate([
    { $match: { product: productId, isApproved: true } },
    { $group: { _id: '$product', avgRating: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  if (stats.length > 0) {
    await Product.findByIdAndUpdate(productId, {
      averageRating: Math.round(stats[0].avgRating * 10) / 10,
      reviewCount:   stats[0].count,
    });
  } else {
    await Product.findByIdAndUpdate(productId, { averageRating: 0, reviewCount: 0 });
  }
}

const Review = mongoose.model('Review', reviewSchema);


/* ============================================================
   PROCESSED EVENT MODEL — Stripe webhook idempotency
   ============================================================ */
const processedEventSchema = new mongoose.Schema(
  {
    eventId:   { type: String, required: true, unique: true },
    type:      { type: String, required: true },
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 30 }, // TTL: auto-delete after 30 days
  },
  { versionKey: false }
);

const ProcessedEvent = mongoose.model('ProcessedEvent', processedEventSchema);


module.exports = { Cart, Contact, Newsletter, Vendor, Event, Review, ProcessedEvent };
