'use strict';

const nodemailer = require('nodemailer');
const logger     = require('./logger');

// ── Create transporter ────────────────────────────────────
let transporter;

const getTransporter = () => {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT) || 465,
    secure: process.env.SMTP_SECURE === 'true',
    auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    pool:          true,
    maxConnections:5,
    rateDelta:     1000,
    rateLimit:     5,
  });
  return transporter;
};

// ── Base mailer ───────────────────────────────────────────
const sendEmail = async ({ to, subject, html, text }) => {
  try {
    const info = await getTransporter().sendMail({
      from: `"${process.env.EMAIL_FROM_NAME || 'ReBrew'}" <${process.env.EMAIL_FROM}>`,
      to, subject, html,
      text: text || html.replace(/<[^>]*>/g, ''),
    });
    logger.info(`Email sent to ${to}: ${info.messageId}`);
    return info;
  }catch (err) {
    console.error(err);
    logger.error(err.stack || err.message);
}
};

// ── Shared brand colours ──────────────────────────────────
const C = {
  dark:      '#3B2410',
  cream:     '#F5EDD6',
  paper:     '#EAD9B0',
  brown:     '#5C3D1E',
  gold:      '#B8963E',
  burgundy:  '#6B2737',
};

// ── Logo (CID inline alternative — use hosted URL) ───────
const logoUrl = (process.env.FRONTEND_URL || 'https://rebrew.in') + '/assets/logos/rebrew-logo.png';

// ── Branded HTML shell ────────────────────────────────────
const shell = (content, { showLogo = true } = {}) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ReBrew</title>
</head>
<body style="margin:0;padding:0;background:${C.cream};font-family:Georgia,serif;">
<div style="max-width:600px;margin:0 auto;background:${C.cream};">

  <!-- Header -->
  <div style="background:${C.dark};padding:28px 40px;text-align:center;">
    ${showLogo
      ? `<img src="${logoUrl}" alt="ReBrew" width="52" style="margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;">`
      : ''}
    <h1 style="color:${C.cream};font-size:28px;letter-spacing:0.12em;margin:0;font-family:Georgia,serif;">REBREW</h1>
    <p style="color:rgba(245,237,214,0.4);font-size:10px;letter-spacing:0.3em;margin:6px 0 0;text-transform:uppercase;">
      Brewed · Bottled · Wrapped
    </p>
  </div>

  <!-- Body -->
  <div style="padding:36px 40px;background:${C.paper};">
    ${content}
  </div>

  <!-- Footer -->
  <div style="background:${C.dark};padding:20px 40px;text-align:center;">
    <p style="color:rgba(245,237,214,0.35);font-size:11px;margin:0;line-height:1.8;">
      ReBrew · Coimbatore, Tamil Nadu, India<br>
      <a href="${process.env.FRONTEND_URL || 'https://rebrew.in'}" style="color:rgba(245,237,214,0.55);text-decoration:none;">rebrew.in</a>
      &nbsp;·&nbsp;
      <a href="https://instagram.com/rebrew.in" style="color:rgba(245,237,214,0.55);text-decoration:none;">@rebrew.in</a>
      &nbsp;·&nbsp;
      <a href="mailto:${process.env.ADMIN_EMAIL || 'hello@rebrew.in'}" style="color:rgba(245,237,214,0.55);text-decoration:none;">${process.env.ADMIN_EMAIL || 'hello@rebrew.in'}</a>
    </p>
    <p style="color:rgba(245,237,214,0.22);font-size:10px;margin:10px 0 0;">
      © ${new Date().getFullYear()} ReBrew. All rights reserved.
    </p>
  </div>
</div>
</body>
</html>`;

// ── Divider ───────────────────────────────────────────────
const divider = `<hr style="border:none;border-top:1px solid rgba(92,61,30,0.15);margin:20px 0;">`;

// ── Label/value row ───────────────────────────────────────
const row = (label, value) =>
  `<tr>
    <td style="padding:8px 0;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;
               color:${C.gold};width:38%;vertical-align:top;">${label}</td>
    <td style="padding:8px 0;font-size:14px;color:${C.dark};font-weight:600;">${value}</td>
  </tr>`;

// ── Order items table WITH product images (customer email) ─
const itemsTableWithImages = (items = []) => `
<table style="width:100%;border-collapse:collapse;margin-top:4px;">
  ${items.map(i => `
  <tr style="border-bottom:1px solid rgba(92,61,30,0.1);">
    <td style="padding:10px 0;width:56px;vertical-align:top;">
      ${i.image
        ? `<img src="${i.image}" alt="${i.name}" width="48" height="48"
               style="border-radius:4px;object-fit:cover;display:block;">`
        : `<div style="width:48px;height:48px;background:${C.gold};border-radius:4px;"></div>`}
    </td>
    <td style="padding:10px 0 10px 12px;color:${C.brown};font-size:14px;vertical-align:middle;">
      ${i.name}<br>
      <span style="font-size:12px;color:rgba(92,61,30,0.6);">Qty: ${i.quantity}</span>
    </td>
    <td style="padding:10px 0;color:${C.dark};font-size:14px;font-weight:700;text-align:right;vertical-align:middle;">
      ₹${(i.subtotal || i.price * i.quantity).toLocaleString('en-IN')}
    </td>
  </tr>`).join('')}
</table>`;

// ── Order items table ─────────────────────────────────────
const itemsTable = (items = []) => `
<table style="width:100%;border-collapse:collapse;margin-top:4px;">
  <thead>
    <tr style="border-bottom:1.5px solid ${C.gold};">
      <th style="padding:8px 0;text-align:left;font-size:10px;letter-spacing:0.2em;
                 text-transform:uppercase;color:${C.gold};font-weight:600;">Product</th>
      <th style="padding:8px 0;text-align:center;font-size:10px;letter-spacing:0.2em;
                 text-transform:uppercase;color:${C.gold};font-weight:600;">Qty</th>
      <th style="padding:8px 0;text-align:right;font-size:10px;letter-spacing:0.2em;
                 text-transform:uppercase;color:${C.gold};font-weight:600;">Amount</th>
    </tr>
  </thead>
  <tbody>
    ${items.map(i => `
    <tr style="border-bottom:1px solid rgba(92,61,30,0.1);">
      <td style="padding:11px 0;color:${C.brown};font-size:14px;">${i.name}</td>
      <td style="padding:11px 0;color:${C.brown};font-size:14px;text-align:center;">×${i.quantity}</td>
      <td style="padding:11px 0;color:${C.dark};font-size:14px;font-weight:700;text-align:right;">
        ₹${(i.subtotal || i.price * i.quantity).toLocaleString('en-IN')}
      </td>
    </tr>`).join('')}
  </tbody>
</table>`;

// ── Totals block ──────────────────────────────────────────
const totalsBlock = (order) => `
<table style="width:100%;border-collapse:collapse;margin-top:8px;">
  <tr>
    <td style="padding:6px 0;color:${C.brown};font-size:13px;">Subtotal</td>
    <td style="padding:6px 0;color:${C.dark};font-size:13px;text-align:right;">
      ₹${(order.itemsTotal || 0).toLocaleString('en-IN')}
    </td>
  </tr>
  <tr>
    <td style="padding:6px 0;color:${C.brown};font-size:13px;">
      Shipping <span style="font-size:11px;color:${C.gold};">(${order.deliveryEstimate || ''})</span>
    </td>
    <td style="padding:6px 0;color:${C.dark};font-size:13px;text-align:right;">
      ₹${(order.shippingCost || 0).toLocaleString('en-IN')}
    </td>
  </tr>
  ${order.discount > 0 ? `
  <tr>
    <td style="padding:6px 0;color:${C.brown};font-size:13px;">Discount</td>
    <td style="padding:6px 0;color:${C.burgundy};font-size:13px;text-align:right;">
      −₹${order.discount.toLocaleString('en-IN')}
    </td>
  </tr>` : ''}
  <tr style="border-top:1.5px solid ${C.gold};">
    <td style="padding:14px 0 6px;color:${C.dark};font-size:17px;font-weight:700;">
      Total Paid
    </td>
    <td style="padding:14px 0 6px;color:${C.dark};font-size:17px;font-weight:700;text-align:right;">
      ₹${(order.totalAmount || 0).toLocaleString('en-IN')}
    </td>
  </tr>
</table>`;

/* ═══════════════════════════════════════════════════════════
   WELCOME EMAIL
════════════════════════════════════════════════════════════ */
const sendWelcomeEmail = async (user) => {
  await sendEmail({
    to:      user.email,
    subject: 'Welcome to ReBrew 🍊',
    html: shell(`
      <h2 style="color:${C.dark};margin:0 0 16px;font-size:22px;">
        Welcome, ${user.name}!
      </h2>
      <p style="color:${C.brown};line-height:1.8;margin:0 0 20px;">
        You're now part of the ReBrew family. Every bottle has its own story — and yours starts here.
      </p>
      <p style="color:${C.brown};line-height:1.8;font-style:italic;margin:0 0 28px;">
        "Time makes it wild." — ReBrew
      </p>
      <a href="${process.env.FRONTEND_URL}/shop.html"
         style="display:inline-block;padding:14px 32px;background:${C.gold};color:${C.dark};
                text-decoration:none;font-weight:700;letter-spacing:0.1em;
                text-transform:uppercase;font-size:12px;">
        Shop the Collection →
      </a>
    `),
  });
};

/* ═══════════════════════════════════════════════════════════
   CUSTOMER ORDER CONFIRMATION EMAIL
   Includes: logo, invoice, order number, items, shipping,
   delivery estimate, payment status, total, support.
════════════════════════════════════════════════════════════ */
const sendOrderConfirmationEmail = async (order, user) => {
  const recipientEmail = user?.email || order?.guestEmail;
  if (!recipientEmail) return;

  const paymentBadge = order.paymentStatus === 'paid'
    ? `<span style="display:inline-block;padding:4px 12px;background:#2d7a4f;color:white;
                    font-size:11px;letter-spacing:0.15em;text-transform:uppercase;">✓ PAID</span>`
    : `<span style="display:inline-block;padding:4px 12px;background:${C.burgundy};color:white;
                    font-size:11px;letter-spacing:0.15em;text-transform:uppercase;">
        ${(order.paymentStatus || 'pending').toUpperCase()}
      </span>`;

  await sendEmail({
    to:      recipientEmail,
    subject: '🎉 Your ReBrew Order is Confirmed!',
    html: shell(`
      <!-- Status badge -->
      <div style="margin-bottom:24px;">${paymentBadge}</div>

      <h2 style="color:${C.dark};margin:0 0 6px;font-size:24px;">Thank you, ${user?.name || order.shippingAddress?.fullName || 'friend'}! ✦</h2>
      <p style="color:${C.brown};margin:0 0 28px;font-size:14px;line-height:1.6;">
        Your order is confirmed and we're getting your ReBrew ready to ship.
      </p>

      <!-- Invoice details -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:4px;">
        ${order.invoiceNumber ? row('Invoice No.', order.invoiceNumber) : ''}
        ${row('Order No.', order.orderNumber)}
        ${row('Order Date', new Date(order.createdAt || Date.now()).toLocaleDateString('en-IN', { day:'2-digit', month:'long', year:'numeric' }))}
        ${row('Payment Method', order.paymentMethod ? order.paymentMethod.toUpperCase() : '—')}
        ${row('Payment Status', paymentBadge)}
      </table>

      ${divider}

      <!-- Items -->
      <p style="font-size:10px;letter-spacing:0.25em;text-transform:uppercase;color:${C.gold};margin:0 0 4px;">
        Items Ordered
      </p>
      ${itemsTableWithImages(order.items || [])}

      ${divider}

      <!-- Totals -->
      ${totalsBlock(order)}

      ${divider}

      <!-- Shipping address -->
      <p style="font-size:10px;letter-spacing:0.25em;text-transform:uppercase;color:${C.gold};margin:0 0 12px;">
        Shipping To
      </p>
      <p style="color:${C.dark};font-size:14px;line-height:1.8;margin:0 0 4px;">
        <strong>${order.shippingAddress?.fullName || ''}</strong><br>
        ${order.shippingAddress?.line1 || ''}${order.shippingAddress?.line2 ? ', ' + order.shippingAddress.line2 : ''}<br>
        ${order.shippingAddress?.city || ''}, ${order.shippingAddress?.state || ''} — ${order.shippingAddress?.pincode || ''}<br>
        📞 ${order.shippingAddress?.phone || ''}
      </p>

      <div style="margin-top:12px;padding:12px 16px;background:rgba(184,150,62,0.1);
                  border-left:3px solid ${C.gold};">
        <p style="margin:0;color:${C.dark};font-size:13px;">
          🚚 <strong>Estimated Delivery:</strong> ${order.deliveryEstimate || '—'}
        </p>
      </div>

      ${divider}

      <p style="color:${C.brown};font-size:13px;line-height:1.7;margin:0;">
        Questions about your order? Write to
        <a href="mailto:${process.env.ADMIN_EMAIL || 'hello@rebrew.in'}" style="color:${C.gold};">${process.env.ADMIN_EMAIL || 'hello@rebrew.in'}</a>.
        We reply within 24 hours.
      </p>
    `),
  });
};

/* ═══════════════════════════════════════════════════════════
   ADMIN ORDER NOTIFICATION EMAIL
   Contains everything needed to fulfil the order.
════════════════════════════════════════════════════════════ */
const sendAdminOrderEmail = async (order, customerName, customerEmail) => {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return;

  await sendEmail({
    to:      adminEmail,
    subject: `🚨 NEW ORDER - ${order.invoiceNumber || order.orderNumber}`,
    html: shell(`
      <h2 style="color:${C.dark};margin:0 0 4px;font-size:22px;">New Order Received</h2>
      <p style="color:${C.brown};margin:0 0 24px;font-size:13px;">Fulfil before the delivery window closes.</p>

      <!-- Order meta -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:4px;">
        ${order.invoiceNumber ? row('Invoice', order.invoiceNumber) : ''}
        ${row('Order No.', order.orderNumber)}
        ${row('Order Time', new Date(order.createdAt || Date.now()).toLocaleString('en-IN'))}
        ${row('Payment Method', (order.paymentMethod || '—').toUpperCase())}
        ${row('Payment Status', (order.paymentStatus || '—').toUpperCase())}
        ${row('Razorpay ID', order.razorpayPaymentId || '—')}
      </table>

      ${divider}

      <!-- Customer details -->
      <p style="font-size:10px;letter-spacing:0.25em;text-transform:uppercase;color:${C.gold};margin:0 0 8px;">Customer</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:4px;">
        ${row('Name', customerName || order.shippingAddress?.fullName || '—')}
        ${row('Phone', order.shippingAddress?.phone || '—')}
        ${row('Email', customerEmail || '—')}
      </table>

      ${divider}

      <!-- Items -->
      <p style="font-size:10px;letter-spacing:0.25em;text-transform:uppercase;color:${C.gold};margin:0 0 4px;">Items to Pack</p>
      ${itemsTable(order.items || [])}

      ${divider}

      ${totalsBlock(order)}

      ${divider}

      <!-- Shipping details -->
      <p style="font-size:10px;letter-spacing:0.25em;text-transform:uppercase;color:${C.gold};margin:0 0 12px;">
        Complete Shipping Address
      </p>
      <p style="color:${C.dark};font-size:14px;line-height:1.9;margin:0;">
        <strong>${order.shippingAddress?.fullName || ''}</strong><br>
        ${order.shippingAddress?.line1 || ''}${order.shippingAddress?.line2 ? ', ' + order.shippingAddress.line2 : ''}<br>
        ${order.shippingAddress?.city || ''}, ${order.shippingAddress?.state || ''} — ${order.shippingAddress?.pincode || ''}<br>
        ${order.shippingAddress?.country || 'India'}<br>
        📞 ${order.shippingAddress?.phone || ''}
      </p>

      ${order.customerNote ? `
      ${divider}
      <p style="font-size:10px;letter-spacing:0.25em;text-transform:uppercase;color:${C.gold};margin:0 0 8px;">Customer Note</p>
      <p style="color:${C.dark};font-size:14px;line-height:1.7;margin:0;font-style:italic;">"${order.customerNote}"</p>
      ` : ''}

      <div style="margin-top:16px;padding:14px 16px;background:rgba(184,150,62,0.12);
                  border-left:3px solid ${C.gold};">
        <p style="margin:0;color:${C.dark};font-size:14px;font-weight:700;">
          🚚 Delivery Commitment: ${order.deliveryEstimate || '—'}
        </p>
      </div>
    `),
  });
};

/* ═══════════════════════════════════════════════════════════
   PASSWORD RESET
════════════════════════════════════════════════════════════ */
const sendPasswordResetEmail = async (user, resetToken) => {
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
  await sendEmail({
    to:      user.email,
    subject: 'Reset Your ReBrew Password',
    html: shell(`
      <h2 style="color:${C.dark};margin:0 0 16px;">Password Reset</h2>
      <p style="color:${C.brown};line-height:1.8;">
        Someone requested a password reset for your account.
        Click below to reset it. This link expires in <strong>10 minutes</strong>.
      </p>
      <a href="${resetUrl}"
         style="display:inline-block;margin-top:24px;padding:14px 32px;background:${C.gold};
                color:${C.dark};text-decoration:none;font-weight:700;
                letter-spacing:0.1em;text-transform:uppercase;font-size:12px;">
        Reset Password →
      </a>
      <p style="margin-top:24px;color:rgba(92,61,30,0.5);font-size:12px;">
        If you didn't request this, ignore this email — your account remains secure.
      </p>
    `),
  });
};

/* ═══════════════════════════════════════════════════════════
   CONTACT ACKNOWLEDGEMENT
════════════════════════════════════════════════════════════ */
const sendContactAcknowledgement = async (contact) => {
  await sendEmail({
    to:      contact.email,
    subject: 'We received your message — ReBrew',
    html: shell(`
      <h2 style="color:${C.dark};margin:0 0 16px;">
        Thanks for reaching out, ${contact.name}.
      </h2>
      <p style="color:${C.brown};line-height:1.8;">
        We've received your message and will reply within 24 hours, Monday to Saturday.
      </p>
      <p style="color:${C.brown};line-height:1.8;font-style:italic;">
        "A small team that actually replies." — ReBrew
      </p>
    `),
  });
};

/* ═══════════════════════════════════════════════════════════
   ADMIN CONTACT FORM NOTIFICATION
════════════════════════════════════════════════════════════ */
const sendAdminContactNotification = async (contact) => {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return;

  await sendEmail({
    to:      adminEmail,
    subject: '📩 New Contact Form Submission',
    html: shell(`
      <h2 style="color:${C.dark};margin:0 0 20px;font-size:22px;">New Contact Form Submission</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:4px;">
        ${row('Name', contact.name)}
        ${row('Email', contact.email)}
        ${row('Phone', contact.phone || '—')}
        ${row('Subject', contact.enquiryType || 'general')}
        ${row('Date', new Date(contact.createdAt || Date.now()).toLocaleString('en-IN'))}
      </table>
      ${divider}
      <p style="font-size:10px;letter-spacing:0.25em;text-transform:uppercase;color:${C.gold};margin:0 0 8px;">Message</p>
      <p style="color:${C.dark};font-size:14px;line-height:1.8;margin:0;white-space:pre-wrap;">${contact.message}</p>
    `),
  });
};

/* ═══════════════════════════════════════════════════════════
   ADMIN: NEW REVIEW SUBMITTED
════════════════════════════════════════════════════════════ */
const sendAdminReviewNotification = async (review) => {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return;

  const stars = '⭐'.repeat(Math.min(5, Math.max(1, review.rating || 1)));

  await sendEmail({
    to:      adminEmail,
    subject: '⭐ New Review Submitted',
    html: shell(`
      <h2 style="color:${C.dark};margin:0 0 20px;font-size:22px;">New Review Submitted</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:4px;">
        ${row('Customer', review.user?.name || '—')}
        ${row('Product', review.product?.name || '—')}
        ${row('Rating', `${stars} (${review.rating}/5)`)}
        ${row('Submitted', new Date(review.createdAt || Date.now()).toLocaleString('en-IN'))}
      </table>
      ${divider}
      <p style="font-size:10px;letter-spacing:0.25em;text-transform:uppercase;color:${C.gold};margin:0 0 8px;">Review</p>
      <p style="color:${C.dark};font-size:14px;line-height:1.8;margin:0;white-space:pre-wrap;">${review.body || '—'}</p>
      ${divider}
      <p style="color:${C.brown};font-size:13px;">
        Approve or reject this review from the admin dashboard.
      </p>
    `),
  });
};

/* ═══════════════════════════════════════════════════════════
   CUSTOMER: REVIEW APPROVED
════════════════════════════════════════════════════════════ */
const sendReviewApprovedEmail = async (review) => {
  const recipientEmail = review.user?.email;
  if (!recipientEmail) return;

  await sendEmail({
    to:      recipientEmail,
    subject: 'Your ReBrew review is now live!',
    html: shell(`
      <h2 style="color:${C.dark};margin:0 0 16px;font-size:22px;">
        Thanks for sharing, ${review.user?.name || 'friend'}! ✦
      </h2>
      <p style="color:${C.brown};line-height:1.8;margin:0 0 20px;">
        Your review for <strong>${review.product?.name || 'your ReBrew brew'}</strong> has been approved
        and is now live on our site for other customers to see.
      </p>
      <a href="${process.env.FRONTEND_URL}/reviews.html"
         style="display:inline-block;padding:14px 32px;background:${C.gold};color:${C.dark};
                text-decoration:none;font-weight:700;letter-spacing:0.1em;
                text-transform:uppercase;font-size:12px;">
        View Reviews →
      </a>
      <p style="margin-top:28px;color:${C.brown};line-height:1.8;font-style:italic;">
        Thank you for helping other brew lovers discover ReBrew.
      </p>
    `),
  });
};

/* ═══════════════════════════════════════════════════════════
   ADMIN: LOW STOCK ALERT
   Triggered when a product's stock drops to <= 5 units.
════════════════════════════════════════════════════════════ */
const sendLowStockAlert = async (product) => {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return;

  await sendEmail({
    to:      adminEmail,
    subject: `⚠ LOW STOCK ALERT — ${product.name}`,
    html: shell(`
      <div style="text-align:center;margin-bottom:20px;">
        <span style="font-size:40px;">⚠️</span>
      </div>
      <h2 style="color:${C.burgundy};margin:0 0 20px;font-size:22px;text-align:center;">
        Low Stock Alert
      </h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:4px;">
        ${row('Product', product.name)}
        ${row('Remaining Quantity', `<span style="color:${C.burgundy};font-weight:800;">${product.stock} units</span>`)}
        ${row('Flavor', (product.flavor || '').replace('_', ' '))}
      </table>
      ${divider}
      <p style="color:${C.brown};font-size:13px;line-height:1.7;">
        Restock soon to avoid running out and losing sales.
      </p>
    `),
  });
};

module.exports = {
  sendEmail,
  sendWelcomeEmail,
  sendOrderConfirmationEmail,
  sendAdminOrderEmail,
  sendPasswordResetEmail,
  sendContactAcknowledgement,
  sendAdminContactNotification,
  sendAdminReviewNotification,
  sendReviewApprovedEmail,
  sendLowStockAlert,
};
