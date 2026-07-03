'use strict';

/**
 * ReBrew — WhatsApp Notification Service
 * Provider: Interakt (https://interakt.ai)
 *
 * Interakt uses the Official WhatsApp Business API.
 * Messages are sent via HTTPS POST to their REST API.
 * No SDK needed — plain fetch/https call.
 *
 * Required env vars:
 *   INTERAKT_API_KEY      — from Interakt dashboard → Settings → API Key
 *   ADMIN_WHATSAPP_NUMBER — admin mobile number WITHOUT country code prefix
 *                           e.g. 9876543210 (not +91..., not whatsapp:+91...)
 *
 * All functions are FIRE-AND-FORGET:
 * Failures are logged and swallowed — never block the calling request.
 *
 * Interakt API docs: https://developers.interakt.ai/reference
 */

const https  = require('https');
const logger = require('../utils/logger');

const INTERAKT_BASE = 'https://api.interakt.ai/v1/public/message/';

/* ── Core send via Interakt REST API ─────────────────────
   Sends a plain text/template WhatsApp message.
   Always resolves — never rejects.
──────────────────────────────────────────────────────── */
async function send(bodyText) {
  const apiKey  = process.env.INTERAKT_API_KEY;
  const toPhone = process.env.ADMIN_WHATSAPP_NUMBER;

  if (!apiKey) {
    logger.warn('WhatsApp: INTERAKT_API_KEY not set — notifications disabled');
    return;
  }
  if (!toPhone) {
    logger.warn('WhatsApp: ADMIN_WHATSAPP_NUMBER not set — notifications disabled');
    return;
  }

  const payload = JSON.stringify({
    countryCode: '+91',
    phoneNumber: toPhone,
    type:        'Text',
    data: {
      message: bodyText,
    },
  });

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.interakt.ai',
      path:     '/v1/public/message/',
      method:   'POST',
      headers: {
        'Authorization': `Basic ${apiKey}`,
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          logger.info(`WhatsApp sent via Interakt (${res.statusCode})`);
        } else {
          logger.error(`WhatsApp Interakt error ${res.statusCode}: ${data}`);
        }
        resolve();
      });
    });

    req.on('error', (err) => {
      // Never let a notification failure propagate
      logger.error(`WhatsApp Interakt request failed: ${err.message}`);
      resolve();
    });

    req.setTimeout(8000, () => {
      logger.error('WhatsApp Interakt request timed out');
      req.destroy();
      resolve();
    });

    req.write(payload);
    req.end();
  });
}

/* ── 1. New Order ────────────────────────────────────────
   Includes: order number, invoice, customer, phone,
   items, shipping cost, delivery estimate, total, payment.
──────────────────────────────────────────────────────── */
async function notifyNewOrder(order, userName) {
  const items = (order.items || [])
    .map(i => `  • ${i.name} × ${i.quantity} = ₹${(i.price * i.quantity).toLocaleString('en-IN')}`)
    .join('\n');

  const body = [
    '🔔 *NEW ORDER — ReBrew*',
    `Invoice: ${order.invoiceNumber || '—'}`,
    `Order:   ${order.orderNumber}`,
    ``,
    `👤 Customer: ${userName || order.shippingAddress?.fullName || '—'}`,
    `📞 Phone: ${order.shippingAddress?.phone || '—'}`,
    ``,
    `🛍 Items:\n${items || '  —'}`,
    ``,
    `🚚 Shipping: ₹${order.shippingCost || 0} — ${order.deliveryEstimate || '—'}`,
    `💰 Total: ₹${order.totalAmount?.toLocaleString('en-IN') || '0'}`,
    `💳 Payment: ${order.paymentMethod || '—'} / ${order.paymentStatus || '—'}`,
  ].join('\n');

  return send(body);
}

/* ── 2. New Contact Form ─────────────────────────────────
   Includes: name, email, phone, subject/type, message.
──────────────────────────────────────────────────────── */
async function notifyNewContact(contact) {
  const message = contact.message?.length > 300
    ? contact.message.slice(0, 297) + '…'
    : contact.message || '—';

  const body = [
    '📩 *NEW CONTACT FORM — ReBrew*',
    `Name:    ${contact.name}`,
    `Email:   ${contact.email}`,
    `Phone:   ${contact.phone || '—'}`,
    `Subject: ${contact.enquiryType || 'general'}`,
    ``,
    `Message:\n${message}`,
  ].join('\n');

  return send(body);
}

/* ── 3. New Approved Review ──────────────────────────────
   Triggered from adminController.updateReview on approval.
   Includes: customer, product, rating, review text.
──────────────────────────────────────────────────────── */
async function notifyNewReview(review, customerName) {
  const stars = '⭐'.repeat(Math.min(5, Math.max(1, review.rating || 1)));
  const text  = review.body?.length > 200
    ? review.body.slice(0, 197) + '…'
    : review.body || '—';

  const body = [
    '⭐ *NEW REVIEW APPROVED — ReBrew*',
    `Customer: ${customerName || '—'}`,
    `Product:  ${review.product?.name || '—'}`,
    `Rating:   ${stars} (${review.rating}/5)`,
    ``,
    `Review:\n${text}`,
  ].join('\n');

  return send(body);
}

module.exports = { notifyNewOrder, notifyNewContact, notifyNewReview };
