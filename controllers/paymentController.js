'use strict';

const crypto    = require('crypto');
const razorpay  = require('../config/razorpay');
const Order     = require('../models/Order');
const Product   = require('../models/Product');
const { Cart, ProcessedEvent } = require('../models/index');
const { AppError, sendSuccess } = require('../utils/apiResponse');
const { validateAndPriceItems } = require('./cartController');
const { sendOrderConfirmationEmail, sendAdminOrderEmail, sendLowStockAlert } = require('../utils/email');
const whatsapp = require('../services/whatsappService');
const logger    = require('../utils/logger');

/* ── Shipping rules ─────────────────────────────────────────
   Coimbatore city  → ₹100 / "Within 2 Hours"
   Tamil Nadu state → ₹200 / "1–2 Business Days"
   Elsewhere        → ₹300 / "2–5 Business Days"
   Always recomputed server-side — never trust client value.
────────────────────────────────────────────────────────── */
const computeShipping = (shippingAddress, itemsTotal, totalBottles) => {

    const city = (shippingAddress?.city || "").trim().toLowerCase();
    const state = (shippingAddress?.state || "").trim().toLowerCase();

    // ---------- Minimum order validation ----------

    if (state === "tamil nadu" && city !== "coimbatore" && totalBottles < 5) {
        throw new AppError(
            "Minimum order outside Coimbatore is 5 bottles.",
            400
        );
    }

    if (state !== "tamil nadu" && totalBottles < 10) {
        throw new AppError(
            "Minimum order outside Tamil Nadu is 10 bottles.",
            400
        );
    }

    // ---------- Free shipping ----------

    if (itemsTotal >= 1000) {
        return {
            shippingCost: 0,
            deliveryEstimate:
                city === "coimbatore"
                    ? "Within 2 Hours"
                    : "Free Delivery",
        };
    }

    // ---------- Normal shipping ----------

    if (city === "coimbatore") {
        return {
            shippingCost: 100,
            deliveryEstimate: "Within 2 Hours",
        };
    }

    if (state === "tamil nadu") {
        return {
            shippingCost: 200,
            deliveryEstimate: "1–2 Business Days",
        };
    }

    return {
        shippingCost: 300,
        deliveryEstimate: "2–5 Business Days",
    };
};

/* ── Atomic stock decrement ─────────────────────────────────
   findOneAndUpdate with stock >= qty guard → can never go negative.
   stockReserved flag set atomically first → no double-decrement.
────────────────────────────────────────────────────────── */
const _decrementStock = async (order) => {
  if (order.stockReserved) {
    logger.info(`Stock already reserved for order ${order.orderNumber} — skipping`);
    return;
  }

  const marked = await Order.findOneAndUpdate(
    { _id: order._id, stockReserved: false },
    { $set: { stockReserved: true } }
  );
  if (!marked) {
    logger.info(`Stock reserve race avoided for order ${order.orderNumber}`);
    return;
  }

  const oversold = [];
  for (const item of order.items) {
    const updated = await Product.findOneAndUpdate(
      { _id: item.product, stock: { $gte: item.quantity } },
      { $inc: { stock: -item.quantity, totalSold: item.quantity } },
      { new: true }
    );
    if (!updated) {
      oversold.push(item.name);
      await Product.findByIdAndUpdate(item.product, {
        $set: { stock: 0 },
        $inc: { totalSold: item.quantity },
      });
    } else if (updated.stock <= 5) {
      // Low stock alert — fire-and-forget, never blocks order/payment flow
      sendLowStockAlert(updated)
        .catch(err => logger.error('Low stock alert email failed:', err.message));
    }
  }

  if (oversold.length > 0) {
    await Order.findByIdAndUpdate(order._id, {
      $set: { adminNote: `OVERSOLD: ${oversold.join(', ')}. Verify before shipping.` },
    });
    logger.warn(`Oversold on order ${order.orderNumber}: ${oversold.join(', ')}`);
  }
};

/* ── Atomic stock restore ───────────────────────────────────
   Only runs if stockReserved === true.
   Clears flag atomically first → no double-restore.
────────────────────────────────────────────────────────── */
const _restoreStock = async (order) => {
  if (!order.stockReserved) {
    logger.info(`Stock not reserved on order ${order.orderNumber} — nothing to restore`);
    return;
  }

  const marked = await Order.findOneAndUpdate(
    { _id: order._id, stockReserved: true },
    { $set: { stockReserved: false } }
  );
  if (!marked) {
    logger.info(`Stock restore race avoided for order ${order.orderNumber}`);
    return;
  }

  const ops = order.items.map(item =>
    Product.findByIdAndUpdate(item.product, {
      $inc: { stock: item.quantity, totalSold: -item.quantity },
    })
  );
  await Promise.all(ops);
  logger.info(`Stock restored for order ${order.orderNumber}`);
};

/* ─────────────────────────────────────────────────────────
   POST /payments/create-order
   1. Validate cart server-side (stock + prices from DB)
   2. Compute shipping from address
   3. Create pending Order in MongoDB
   4. Create Razorpay order
   5. Return razorpay_order_id + key_id to frontend
   Frontend then opens Razorpay Checkout modal.
───────────────────────────────────────────────────────── */
exports.createOrder = async (req, res, next) => {
  try {
    const { shippingAddress, customerNote } = req.body;

    // 1. Validate server-side cart
    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart || cart.items.length === 0) {
      return next(new AppError('Your cart is empty.', 400));
    }

    const { priced, errors } = await validateAndPriceItems(cart.items);
    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cart validation failed before payment.',
        errors,
      });
    }

    // 2. Compute totals server-side — never trust client
    const itemsTotal = priced.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const totalBottles = priced.reduce(
    (sum, item) => sum + item.quantity,
    0
);

const { shippingCost, deliveryEstimate } =
    computeShipping(
        shippingAddress,
        itemsTotal,
        totalBottles
    );
    const grandTotal = itemsTotal + shippingCost;

    // 3. Build order item snapshots
    const productIds = priced.map(i => i.product);
    const products   = await Product.find({ _id: { $in: productIds } })
      .select('name flavor images');
    const productMap = new Map(products.map(p => [p._id.toString(), p]));

    const orderItems = priced.map(item => {
      const p = productMap.get(item.product.toString());
      return {
        product:  item.product,
        name:     p?.name   || 'Unknown',
        flavor:   p?.flavor || '',
        image:    p?.images?.find(i => i.isPrimary)?.url || p?.images?.[0]?.url || '',
        price:    item.price,
        quantity: item.quantity,
        subtotal: item.price * item.quantity,
      };
    });

    // 4. Create pending MongoDB order (stockReserved: false — set only after payment confirmed)
    const pendingOrder = await Order.create({
      user:             req.user._id,
      items:            orderItems,
      shippingAddress,
      itemsTotal,
      shippingCost,
      deliveryEstimate,
      totalAmount:      grandTotal,
      paymentMethod:    'card',   // Updated to actual method after Razorpay response
      paymentStatus:    'pending',
      orderStatus:      'pending',
      stockReserved:    false,
      customerNote,
    });

    // 5. Create Razorpay order
    // Amount must be in paise (INR smallest unit): ₹1 = 100 paise
    const rzpOrder = await razorpay.orders.create({
      amount:          Math.round(grandTotal * 100),
      currency:        'INR',
      receipt:         pendingOrder.orderNumber,
      notes: {
        orderId:  pendingOrder._id.toString(),
        userId:   req.user._id.toString(),
        customer: req.user.email,
      },
    });

    // 6. Save Razorpay order ID to our order document
    pendingOrder.razorpayOrderId = rzpOrder.id;
    await pendingOrder.save({ validateBeforeSave: false });

    logger.info(
      `Razorpay order created: ${rzpOrder.id} for ${pendingOrder.orderNumber} ₹${grandTotal}`
    );

    // 7. Return everything the frontend Razorpay modal needs
    return sendSuccess(res, {
      statusCode: 201,
      message:    'Order created. Complete payment to confirm.',
      data: {
        razorpayOrderId: rzpOrder.id,
        amount:          rzpOrder.amount,       // in paise
        currency:        rzpOrder.currency,
        keyId:           process.env.RAZORPAY_KEY_ID,  // publishable key for frontend
        orderId:         pendingOrder._id,
        orderNumber:     pendingOrder.orderNumber,
        prefill: {
          name:    req.user.name  || '',
          email:   req.user.email || '',
          contact: shippingAddress.phone || '',
        },
      },
    });
  } catch (err) {
    if (err.error?.description) {
      logger.error('Razorpay order creation error:', err.error.description);
      return next(new AppError(`Payment provider error: ${err.error.description}`, 502));
    }
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   POST /payments/verify
   Called by frontend AFTER Razorpay Checkout modal completes.
   SECURITY:
   - Verify HMAC-SHA256 signature before trusting payment
   - Only mark order paid after successful verification
   - This is the ONLY place paymentStatus becomes 'paid'
───────────────────────────────────────────────────────── */
exports.verifyPayment = async (req, res, next) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return next(new AppError('Missing payment verification fields.', 400));
    }

    // 1. Idempotency — reject duplicate payment_id
    const alreadyProcessed = await Order.findOne({ razorpayPaymentId: razorpay_payment_id });
    if (alreadyProcessed) {
      logger.info(`Duplicate payment_id skipped: ${razorpay_payment_id}`);
      return sendSuccess(res, {
        message: 'Payment already recorded.',
        data:    { orderId: alreadyProcessed._id, orderNumber: alreadyProcessed.orderNumber },
      });
    }

    // 2. Verify HMAC-SHA256 signature
    // Razorpay signs: razorpay_order_id + "|" + razorpay_payment_id
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      logger.warn(
        `Razorpay signature mismatch for order ${razorpay_order_id} — possible tampering`
      );
      return next(new AppError('Payment verification failed. Signature mismatch.', 400));
    }

    // 3. Find the pending order
    const order = await Order.findOne({ razorpayOrderId: razorpay_order_id });
    if (!order) {
      return next(new AppError('Order not found for this payment.', 404));
    }

    if (order.paymentStatus === 'paid') {
      logger.info(`Order ${order.orderNumber} already paid — skipping`);
      return sendSuccess(res, {
        message: 'Order already confirmed.',
        data:    { orderId: order._id, orderNumber: order.orderNumber },
      });
    }

    // 4. Fetch payment details from Razorpay to get actual method used
    let paymentDetails;
    try {
      paymentDetails = await razorpay.payments.fetch(razorpay_payment_id);
    } catch (fetchErr) {
      logger.warn(`Could not fetch payment details: ${fetchErr.message}`);
    }

    // Map Razorpay method to our enum
    const methodMap = {
      card:       'card',
      upi:        'upi',
      wallet:     'wallet',
      netbanking: 'netbanking',
    };
    const paymentMethod = methodMap[paymentDetails?.method] || 'card';

    // 5. Mark order paid + generate invoice number
    order.paymentStatus      = 'paid';
    order.orderStatus        = 'confirmed';
    order.paidAt             = new Date();
    order.paymentMethod      = paymentMethod;
    order.razorpayPaymentId  = razorpay_payment_id;
    order.razorpaySignature  = razorpay_signature;
    order.invoiceNumber      = await Order.generateInvoiceNumber();
    await order.save();

    // 6. Decrement stock atomically (idempotent via stockReserved flag)
    await _decrementStock(order);

    // 7. Clear user's server-side cart
    if (order.user) {
      await Cart.findOneAndUpdate({ user: order.user }, { $set: { items: [] } });
    }

    // 8. Send customer confirmation email (non-blocking)
    sendOrderConfirmationEmail(order, { email: req.user.email })
      .catch(err => logger.error('Confirmation email failed:', err.message));

    // Admin fulfilment email (non-blocking)
    sendAdminOrderEmail(order, req.user?.name, req.user?.email)
      .catch(err => logger.error('Admin order email failed:', err.message));

    // WhatsApp admin notification — fire-and-forget, never blocks payment verification
    whatsapp.notifyNewOrder(order, req.user?.name)
      .catch(err => logger.error('WhatsApp order notify failed:', err.message));

    logger.info(
      `Payment verified: ${order.orderNumber} ₹${order.totalAmount} via ${paymentMethod} (${razorpay_payment_id})`
    );

    return sendSuccess(res, {
      message: 'Payment verified. Order confirmed.',
      data:    { orderId: order._id, orderNumber: order.orderNumber },
    });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   POST /payments/webhook
   Razorpay sends JSON (no raw body required).
   Validates X-Razorpay-Signature header.
   Handles: payment.captured, payment.failed, refund.processed
   Only used as a backup — primary verification is in verifyPayment above.
───────────────────────────────────────────────────────── */
exports.handleWebhook = async (req, res) => {
  const receivedSig = req.headers['x-razorpay-signature'];
  const secret      = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!receivedSig || !secret) {
    logger.warn('Razorpay webhook: missing signature or secret');
    return res.status(400).json({ error: 'Webhook configuration error.' });
  }

  // Verify webhook signature
  // Razorpay signs the raw JSON body with HMAC-SHA256
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (expectedSig !== receivedSig) {
    logger.warn('Razorpay webhook: signature mismatch');
    return res.status(400).json({ error: 'Invalid webhook signature.' });
  }

  const event   = req.body;
  const eventId = event.id; // Razorpay webhook events have a unique id field

  logger.info(`Razorpay webhook: ${event.event} [${eventId}]`);

  // Idempotency guard
  try {
    await ProcessedEvent.create({ eventId, type: event.event });
  } catch (err) {
    if (err.code === 11000) {
      logger.info(`Webhook duplicate skipped: ${eventId}`);
      return res.status(200).json({ received: true, duplicate: true });
    }
    logger.error('ProcessedEvent insert error:', err.message);
  }

  // Acknowledge immediately
  res.status(200).json({ received: true });

  // Process async
  try {
    switch (event.event) {
      case 'payment.captured':
        await handlePaymentCaptured(event.payload.payment.entity);
        break;
      case 'payment.failed':
        await handlePaymentFailed(event.payload.payment.entity);
        break;
      case 'refund.processed':
        await handleRefundProcessed(event.payload.refund.entity);
        break;
      default:
        logger.debug(`Unhandled Razorpay event: ${event.event}`);
    }
  } catch (err) {
    logger.error(`Webhook processing error (${event.event}): ${err.message}`);
  }
};

// ── payment.captured ─────────────────────────────────────
// Backup handler — verifyPayment() should run before this.
// Guards with paymentStatus check to prevent double-processing.
const handlePaymentCaptured = async (payment) => {
  const rzpOrderId = payment.order_id;

  const order = await Order.findOne({ razorpayOrderId: rzpOrderId });
  if (!order) { logger.error(`Webhook: order not found for rzp_order: ${rzpOrderId}`); return; }

  if (order.paymentStatus === 'paid') {
    logger.info(`Webhook: ${order.orderNumber} already paid — skipping`);
    return;
  }

  const methodMap = { card: 'card', upi: 'upi', wallet: 'wallet', netbanking: 'netbanking' };

  order.paymentStatus     = 'paid';
  order.orderStatus       = 'confirmed';
  order.paidAt            = new Date();
  order.paymentMethod     = methodMap[payment.method] || 'card';
  order.razorpayPaymentId = payment.id;
  order.invoiceNumber     = await Order.generateInvoiceNumber();
  await order.save();

  await _decrementStock(order);

  if (order.user) {
    await Cart.findOneAndUpdate({ user: order.user }, { $set: { items: [] } });
  }

  logger.info(`Webhook: payment captured for ${order.orderNumber} ₹${payment.amount / 100}`);

  // WhatsApp admin notification — fire-and-forget
  whatsapp.notifyNewOrder(order, order.shippingAddress?.fullName)
    .catch(err => logger.error('WhatsApp webhook order notify failed:', err.message));
};

// ── payment.failed ───────────────────────────────────────
const handlePaymentFailed = async (payment) => {
  const order = await Order.findOne({ razorpayOrderId: payment.order_id });
  if (!order || order.paymentStatus !== 'pending') return;

  order.paymentStatus = 'failed';
  await order.save();

  logger.warn(`Webhook: payment failed for ${order.orderNumber} — ${payment.error_description || 'unknown'}`);
};

// ── refund.processed ─────────────────────────────────────
const handleRefundProcessed = async (refund) => {
  const order = await Order.findOne({ razorpayPaymentId: refund.payment_id });
  if (!order) return;

  const amountRefunded = refund.amount / 100;
  const isFullRefund   = amountRefunded >= order.totalAmount;

  order.paymentStatus = isFullRefund ? 'refunded' : 'partially_refunded';
  order.refundedAt    = new Date();
  order.refundAmount  = amountRefunded;
  await order.save();

  if (isFullRefund) await _restoreStock(order);

  logger.info(`Webhook: refund ₹${amountRefunded} for ${order.orderNumber}`);
};

/* ─────────────────────────────────────────────────────────
   POST /admin/payments/refund/:orderId
   Admin-initiated refund via Razorpay API.
   Restores stock on full refund (exactly once via stockReserved flag).
───────────────────────────────────────────────────────── */
exports.adminRefundOrder = async (req, res, next) => {
  try {
    const { amount, reason } = req.body;
    const order = await Order.findById(req.params.orderId);

    if (!order)                         return next(new AppError('Order not found.', 404));
    if (order.paymentStatus !== 'paid') return next(new AppError('Order is not in a paid state.', 400));
    if (!order.razorpayPaymentId)       return next(new AppError('No Razorpay payment ID on this order.', 400));

    const refundAmount = amount ? Math.round(parseFloat(amount) * 100) : undefined;

    const refund = await razorpay.payments.refund(order.razorpayPaymentId, {
      amount: refundAmount,                // undefined = full refund
      notes:  { reason: reason || 'requested_by_customer', orderId: order._id.toString() },
    });

    const refundedRs  = refund.amount / 100;
    const isFullRefund= !amount || refundedRs >= order.totalAmount;

    order.paymentStatus = isFullRefund ? 'refunded' : 'partially_refunded';
    order.refundedAt    = new Date();
    order.refundAmount  = refundedRs;
    await order.save();

    if (isFullRefund) await _restoreStock(order);

    logger.info(`Admin refund: ${order.orderNumber} ₹${refundedRs} by ${req.user._id}`);

    return sendSuccess(res, {
      message: 'Refund issued.',
      data:    { refundId: refund.id, amount: refundedRs, order },
    });
  } catch (err) {
    if (err.error?.description) {
      logger.error('Razorpay refund error:', err.error.description);
      return next(new AppError(`Razorpay refund failed: ${err.error.description}`, 502));
    }
    next(err);
  }
};
