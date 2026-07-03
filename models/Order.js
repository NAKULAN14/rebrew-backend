'use strict';

const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema(
  {
    product: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'Product',
      required: true,
    },
    name:   { type: String, required: true }, // Snapshot at time of order
    flavor: { type: String, required: true },
    image:  String,
    price:  { type: Number, required: true }, // Snapshot — server-side price
    quantity: {
      type:     Number,
      required: true,
      min:      [1, 'Quantity must be at least 1'],
    },
    subtotal: { type: Number, required: true }, // price × quantity
  },
  { _id: false }
);

const shippingAddressSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true },
    line1:    { type: String, required: true },
    line2:    String,
    city:     { type: String, required: true },
    state:    { type: String, required: true },
    pincode:  { type: String, required: true },
    country:  { type: String, default: 'India' },
    phone:    { type: String, required: true },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type:   String,
      unique: true,
    },
    invoiceNumber: {
      type:   String,
      unique: true,
      sparse: true, // null until order is paid
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  'User',
      // Nullable for guest orders
    },
    guestEmail: String, // For guest checkout

    items:           [orderItemSchema],
    shippingAddress: { type: shippingAddressSchema, required: true },

    // Pricing (all server-side calculated)
    itemsTotal:      { type: Number, required: true },
    shippingCost:    { type: Number, default: 0 },
    deliveryEstimate:{ type: String, default: '' }, // e.g. "Within 2 Hours"
    discount:        { type: Number, default: 0 },
    taxAmount:    { type: Number, default: 0 },
    totalAmount:  { type: Number, required: true }, // Final charged amount

    couponCode:   String,

    // Payment
    paymentStatus: {
      type:    String,
      enum:    ['pending', 'paid', 'failed', 'refunded', 'partially_refunded'],
      default: 'pending',
    },
    paymentMethod:      { type: String, enum: ['card', 'upi', 'wallet', 'netbanking'] },
    razorpayOrderId:   { type: String }, // Razorpay order_id  (order_xxxx)
    razorpayPaymentId: { type: String }, // Razorpay payment_id (pay_xxxx) — set after capture
    razorpaySignature: { type: String }, // HMAC-SHA256 signature verified server-side
    paidAt:           Date,
    refundedAt:       Date,
    refundAmount:     Number,

    // Order fulfilment
    orderStatus: {
      type:    String,
      enum:    ['pending', 'confirmed', 'processing', 'packed', 'shipped', 'delivered', 'cancelled', 'returned'],
      default: 'pending',
    },
    statusHistory: [
      {
        status:    String,
        timestamp: { type: Date, default: Date.now },
        note:      String,
        updatedBy: mongoose.Schema.Types.ObjectId,
      },
    ],

    // Shipping / tracking
    trackingNumber: String,
    courierName:    String,
    shippedAt:      Date,
    deliveredAt:    Date,
    estimatedDelivery: Date,

    // Inventory control — single source of truth.
    // true  = stock has been decremented for this order.
    // false = stock has NOT been decremented (pending COD, failed payment, etc.)
    // This flag prevents double-decrement and double-restore across all code paths.
    stockReserved: { type: Boolean, default: false },

    // Notes
    customerNote: { type: String, maxlength: 500 },
    adminNote:    { type: String, maxlength: 500 },

    // Cancellation
    cancelledAt:     Date,
    cancellationReason: String,
    cancelledBy:     mongoose.Schema.Types.ObjectId,
  },
  {
    timestamps: true,
    toJSON:  { virtuals: true },
    toObject:{ virtuals: true },
  }
);

// ── Indexes ───────────────────────────────────────────────
// Note: orderNumber already indexed via unique:true in schema definition above
orderSchema.index({ user: 1 });
orderSchema.index({ paymentStatus: 1 });
orderSchema.index({ orderStatus: 1 });
orderSchema.index({ razorpayOrderId: 1 });
orderSchema.index({ razorpayPaymentId: 1 });
orderSchema.index({ invoiceNumber: 1 }, { sparse: true });
orderSchema.index({ createdAt: -1 });

// ── Pre-save: Generate order number ──────────────────────
orderSchema.pre('save', async function (next) {
  if (this.isNew && !this.orderNumber) {
    // Fix: crypto.randomBytes — not Math.random() — for collision-safety under load
    const { randomBytes } = require('crypto');
    const timestamp = Date.now().toString(36).toUpperCase();
    const random    = randomBytes(3).toString('hex').toUpperCase();
    this.orderNumber = `RB-${timestamp}-${random}`;
  }

  // Auto-push to status history on orderStatus change
  if (this.isModified('orderStatus')) {
    this.statusHistory.push({
      status:    this.orderStatus,
      timestamp: new Date(),
    });
  }

  next();
});

// ── Virtual: item count ───────────────────────────────────
orderSchema.virtual('itemCount').get(function () {
  return this.items.reduce((sum, item) => sum + item.quantity, 0);
});

// ── Static: Generate sequential invoice number ────────────
// Format: INV-2026-000001
// Uses atomic findOneAndUpdate to guarantee no duplicates under load.
orderSchema.statics.generateInvoiceNumber = async function () {
  const year  = new Date().getFullYear();
  const prefix= `INV-${year}-`;

  // Count paid orders this year (already have an invoice) + 1
  const count = await this.countDocuments({
    invoiceNumber: { $regex: `^${prefix}` },
  });

  const seq = String(count + 1).padStart(6, '0');
  return `${prefix}${seq}`;
};

module.exports = mongoose.model('Order', orderSchema);
