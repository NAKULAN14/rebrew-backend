'use strict';

const Order   = require('../models/Order');
const Product = require('../models/Product');
const { Cart } = require('../models/index');
const { AppError, sendSuccess, sendPaginated } = require('../utils/apiResponse');
const { sendOrderConfirmationEmail } = require('../utils/email');
const whatsapp = require('../services/whatsappService');
const { validateAndPriceItems } = require('./cartController');
const logger  = require('../utils/logger');

/* ── Shipping rules (mirrors paymentController and checkout.js) ──
   Single source of truth for server-side shipping calculation.
   Coimbatore city  → ₹100 / "Within 2 Hours"
   Tamil Nadu state → ₹200 / "1–2 Business Days"
   Elsewhere        → ₹300 / "2–5 Business Days"
────────────────────────────────────────────────────────────────── */
const computeShipping = (shippingAddress) => {
  const city  = (shippingAddress?.city  || '').trim().toLowerCase();
  const state = (shippingAddress?.state || '').trim().toLowerCase();

  if (city === 'coimbatore') {
    return { shippingCost: 100, deliveryEstimate: 'Within 2 Hours' };
  }
  if (state === 'tamil nadu' || state === 'tamilnadu' || state === 'tn') {
    return { shippingCost: 200, deliveryEstimate: '1–2 Business Days' };
  }
  return { shippingCost: 300, deliveryEstimate: '2–5 Business Days' };
};

/* ─────────────────────────────────────────────────────────
   INTERNAL: Atomic stock decrement
───────────────────────────────────────────────────────── */
const _decrementStockForOrder = async (order) => {
  if (order.stockReserved) return; // already reserved

  const marked = await Order.findOneAndUpdate(
    { _id: order._id, stockReserved: false },
    { $set: { stockReserved: true } }
  );
  if (!marked) return; // concurrent call won the race

  for (const item of order.items) {
    const updated = await Product.findOneAndUpdate(
      { _id: item.product, stock: { $gte: item.quantity } },
      { $inc: { stock: -item.quantity, totalSold: item.quantity } },
      { new: true }
    );
    if (!updated) {
      await Product.findByIdAndUpdate(item.product, {
        $set: { stock: 0 },
        $inc: { totalSold: item.quantity },
      });
      logger.warn(`Oversold on COD order ${order.orderNumber}: ${item.name}`);
    }
  }
};

const _restoreStockForOrder = async (order) => {
  if (!order.stockReserved) return; // nothing to restore

  const marked = await Order.findOneAndUpdate(
    { _id: order._id, stockReserved: true },
    { $set: { stockReserved: false } }
  );
  if (!marked) return; // concurrent call won the race

  const ops = order.items.map(item =>
    Product.findByIdAndUpdate(item.product, {
      $inc: { stock: item.quantity, totalSold: -item.quantity },
    })
  );
  await Promise.all(ops);
  logger.info(`Stock restored for order ${order.orderNumber}`);
};

/* ─────────────────────────────────────────────────────────
   POST /orders
   Only online payments (card, upi). COD removed.
───────────────────────────────────────────────────────── */
exports.createOrder = async (req, res, next) => {
  try {
    const { shippingAddress, paymentMethod, customerNote } = req.body;

    // COD rejected — only online payments accepted
    if (!paymentMethod || paymentMethod === 'cod') {
      return next(new AppError(
        'Cash on delivery is not available. Please pay online via card or UPI.',
        400
      ));
    }

    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart || cart.items.length === 0) return next(new AppError('Your cart is empty.', 400));

    const { priced, errors } = await validateAndPriceItems(cart.items);
    if (errors.length > 0) {
      return res.status(400).json({ success: false, message: 'Cart validation failed.', errors });
    }

    const itemsTotal = priced.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const { shippingCost, deliveryEstimate } = computeShipping(shippingAddress);
    const grandTotal = itemsTotal + shippingCost;

    const productIds = priced.map(i => i.product);
    const products   = await Product.find({ _id: { $in: productIds } }).select('name flavor images');
    const productMap = new Map(products.map(p => [p._id.toString(), p]));

    const orderItems = priced.map(item => {
      const p = productMap.get(item.product.toString());
      return {
        product:  item.product,
        name:     p?.name    || 'Unknown',
        flavor:   p?.flavor  || '',
        image:    p?.images?.find(img => img.isPrimary)?.url || p?.images?.[0]?.url || '',
        price:    item.price,
        quantity: item.quantity,
        subtotal: item.price * item.quantity,
      };
    });

    const order = await Order.create({
      user:             req.user._id,
      items:            orderItems,
      shippingAddress,
      itemsTotal,
      shippingCost,
      deliveryEstimate,
      totalAmount:      grandTotal,
      paymentMethod,
      paymentStatus:    'pending',
      orderStatus:      'pending',
      stockReserved:    false,
      customerNote,
    });

    // Clear cart immediately — the order exists, cart is committed
    await Cart.findOneAndUpdate({ user: req.user._id }, { $set: { items: [] } });

    sendOrderConfirmationEmail(order, req.user)
      .catch(err => logger.error('Order email failed:', err.message));

    // WhatsApp admin notification — fire-and-forget, never blocks order creation
    whatsapp.notifyNewOrder(order, req.user?.name)
      .catch(err => logger.error('WhatsApp order notify failed:', err.message));

    logger.info(`COD order created: ${order.orderNumber} ₹${grandTotal} (stock NOT yet reserved)`);

    return sendSuccess(res, { statusCode: 201, message: 'Order placed.', data: { order } });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   GET /orders  —  My orders
───────────────────────────────────────────────────────── */
exports.getMyOrders = async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 10);
    const skip  = (page - 1) * limit;
    const filter = { user: req.user._id };
    if (req.query.status) filter.orderStatus = req.query.status;

    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
        .select('-adminNote -statusHistory -stockReserved').lean(),
      Order.countDocuments(filter),
    ]);

    return sendPaginated(res, { data: orders, total, page, limit, message: 'Orders fetched.' });
  } catch (err) { next(err); }
};

/* ─────────────────────────────────────────────────────────
   GET /orders/:id
───────────────────────────────────────────────────────── */
exports.getOrder = async (req, res, next) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, user: req.user._id })
      .select('-adminNote -stockReserved');
    if (!order) return next(new AppError('Order not found.', 404));
    return sendSuccess(res, { message: 'Order fetched.', data: { order } });
  } catch (err) { next(err); }
};

/* ─────────────────────────────────────────────────────────
   PUT /orders/:id/cancel  —  Customer cancellation
   Fix 8: _restoreStockForOrder uses stockReserved flag.
   If stock was never reserved (pending COD), nothing happens.
   If stock was reserved (confirmed card/COD), it is restored.
───────────────────────────────────────────────────────── */
exports.cancelOrder = async (req, res, next) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, user: req.user._id });
    if (!order) return next(new AppError('Order not found.', 404));

    if (!['pending', 'confirmed'].includes(order.orderStatus)) {
      return next(new AppError(`Cannot cancel an order with status "${order.orderStatus}".`, 400));
    }

    // C2 FIX: Block self-service cancellation of paid orders.
    // Cancelling a Stripe-paid order here would restore stock without issuing a refund,
    // leaving the customer charged with no recourse. Admin must issue the refund via
    // /admin/payments/refund/:orderId which handles both the Stripe refund and stock restore.
    if (order.paymentStatus === 'paid') {
      return next(new AppError(
        'Paid orders cannot be self-cancelled. Please contact support — we will process your refund within 24 hours.',
        400
      ));
    }

    order.orderStatus        = 'cancelled';
    order.cancelledAt        = new Date();
    order.cancellationReason = req.body.reason || 'Cancelled by customer';
    order.cancelledBy        = req.user._id;
    await order.save();

    // Safe to restore stock here: only reaches this point when paymentStatus !== 'paid'
    // (pending COD orders where stockReserved is still false, so _restoreStockForOrder is a no-op)
    await _restoreStockForOrder(order);

    logger.info(`Order cancelled: ${order.orderNumber} by user ${req.user._id}`);
    return sendSuccess(res, { message: 'Order cancelled.', data: { order } });
  } catch (err) { next(err); }
};

/* ─────────────────────────────────────────────────────────
   GET /admin/orders
───────────────────────────────────────────────────────── */
exports.adminGetAllOrders = async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip  = (page - 1) * limit;
    const filter = {};
    if (req.query.status)        filter.orderStatus   = req.query.status;
    if (req.query.paymentStatus) filter.paymentStatus = req.query.paymentStatus;
    if (req.query.search) {
      const safeSearch = String(req.query.search).slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { orderNumber: { $regex: safeSearch, $options: 'i' } },
        { guestEmail:  { $regex: safeSearch, $options: 'i' } },
      ];
    }
    if (req.query.from || req.query.to) {
      filter.createdAt = {};
      if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
      if (req.query.to)   filter.createdAt.$lte = new Date(req.query.to);
    }

    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
        .populate('user', 'name email phone').lean(),
      Order.countDocuments(filter),
    ]);

    return sendPaginated(res, { data: orders, total, page, limit, message: 'Orders fetched.' });
  } catch (err) { next(err); }
};

/* ─────────────────────────────────────────────────────────
   GET /admin/orders/:id
───────────────────────────────────────────────────────── */
exports.adminGetOrder = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id).populate('user', 'name email phone');
    if (!order) return next(new AppError('Order not found.', 404));
    return sendSuccess(res, { message: 'Order fetched.', data: { order } });
  } catch (err) { next(err); }
};

/* ─────────────────────────────────────────────────────────
   PUT /admin/orders/:id
   Fix 5: COD confirmed → decrement stock (first time only).
   Fix 9: Status transition map enforced.
   Fix 8: Cancellation from confirmed → restore stock.
───────────────────────────────────────────────────────── */
exports.adminUpdateOrder = async (req, res, next) => {
  try {
    const {
      orderStatus, trackingNumber, courierName,
      estimatedDelivery, adminNote, paymentStatus,
    } = req.body;

    const order = await Order.findById(req.params.id);
    if (!order) return next(new AppError('Order not found.', 404));

    // H1 FIX: 'paid' may never be set manually — it arrives only via Stripe webhook.
    if (paymentStatus === 'paid') {
      return next(new AppError(
        'Payment status cannot be manually set to "paid". It is updated automatically by Stripe.',
        400
      ));
    }

    const validTransitions = {
      pending:    ['confirmed', 'cancelled'],
      confirmed:  ['processing', 'cancelled'],
      processing: ['packed', 'cancelled'],
      packed:     ['shipped'],
      shipped:    ['delivered'],
      delivered:  [],
      cancelled:  [],
      returned:   [],
    };

    // H2 FIX: Determine required stock action but do NOT save inside this block.
    // Collect all mutations first, then call save() exactly once so the pre-save
    // statusHistory hook fires exactly once per transition.
    let stockAction = null;

    if (orderStatus && orderStatus !== order.orderStatus) {
      const allowed = validTransitions[order.orderStatus] || [];
      if (!allowed.includes(orderStatus)) {
        return next(new AppError(
          `Cannot transition order from "${order.orderStatus}" to "${orderStatus}".`, 400
        ));
      }

      const prevStatus  = order.orderStatus;
      order.orderStatus = orderStatus;

      if (orderStatus === 'shipped')   order.shippedAt   = new Date();
      if (orderStatus === 'delivered') order.deliveredAt = new Date();

      // COD is removed — stock decrement path here is only reached if admin
      // manually confirms an order that bypassed the Stripe webhook (edge case).
      // Card/UPI orders have stockReserved:true already set by the webhook.
      if (orderStatus === 'confirmed' && !order.stockReserved) {
        stockAction = 'decrement';
      } else if (
        orderStatus === 'cancelled' &&
        ['confirmed', 'processing', 'packed'].includes(prevStatus)
      ) {
        stockAction = 'restore';
      }
    }

    // Apply all remaining field mutations before the single save()
    if (paymentStatus !== undefined)  order.paymentStatus    = paymentStatus;
    if (trackingNumber !== undefined) order.trackingNumber   = trackingNumber;
    if (courierName    !== undefined) order.courierName      = courierName;
    if (estimatedDelivery)            order.estimatedDelivery = new Date(estimatedDelivery);
    if (adminNote !== undefined)      order.adminNote        = adminNote;

    // H2 FIX: Single save() — pre-save hook fires exactly once → one statusHistory entry
    await order.save();

    // Stock operations after save so they read committed DB state
    if (stockAction === 'decrement') await _decrementStockForOrder(order);
    if (stockAction === 'restore')   await _restoreStockForOrder(order);

    logger.info(`Order ${order.orderNumber} → "${order.orderStatus}" by admin ${req.user._id}`);
    return sendSuccess(res, { message: 'Order updated.', data: { order } });
  } catch (err) { next(err); }
};

/* ─────────────────────────────────────────────────────────
   GET /admin/orders/stats
───────────────────────────────────────────────────────── */
exports.adminGetOrderStats = async (req, res, next) => {
  try {
    const now        = new Date();
    const today      = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [totalOrders, todayOrders, monthOrders, pendingOrders, revenueData] = await Promise.all([
      Order.countDocuments({ paymentStatus: 'paid' }),
      Order.countDocuments({ createdAt: { $gte: today }, paymentStatus: 'paid' }),
      Order.countDocuments({ createdAt: { $gte: monthStart }, paymentStatus: 'paid' }),
      Order.countDocuments({ orderStatus: 'pending' }),
      Order.aggregate([
        { $match: { paymentStatus: 'paid' } },
        { $group: { _id: null, total: { $sum: '$totalAmount' }, avg: { $avg: '$totalAmount' } } },
      ]),
    ]);

    const revenue = revenueData[0] || { total: 0, avg: 0 };
    return sendSuccess(res, {
      message: 'Order stats fetched.',
      data: { totalOrders, todayOrders, monthOrders, pendingOrders,
        totalRevenue: revenue.total, averageOrderValue: Math.round(revenue.avg) },
    });
  } catch (err) { next(err); }
};
