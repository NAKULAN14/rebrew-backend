'use strict';

const { Vendor }  = require('../models/index');
const { AppError, sendSuccess, sendPaginated } = require('../utils/apiResponse');
const { sendEmail, sendContactAcknowledgement } = require('../utils/email');
const logger      = require('../utils/logger');

/* ─────────────────────────────────────────────────────────
   POST /vendor/apply
   Public — submit wholesale/vendor application
───────────────────────────────────────────────────────── */
exports.applyAsVendor = async (req, res, next) => {
  try {
    const {
      businessName, contactPerson, email, phone,
      businessType, location, estimatedMonthlyVolume,
      currentBrands, notes,
    } = req.body;

    // Check for duplicate application from same email (within 30 days)
    const recentApplication = await Vendor.findOne({
      email:     email.toLowerCase(),
      createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    });

    if (recentApplication) {
      return next(
        new AppError(
          'An application from this email was received recently. Please wait before reapplying.',
          409
        )
      );
    }

    const vendor = await Vendor.create({
      businessName,
      contactPerson,
      email:      email.toLowerCase(),
      phone,
      businessType,
      location,
      estimatedMonthlyVolume: estimatedMonthlyVolume ? parseInt(estimatedMonthlyVolume) : undefined,
      currentBrands,
      notes,
      ipAddress: req.ip,
    });

    // Acknowledgement email to applicant (non-blocking)
    sendEmail({
      to:      vendor.email,
      subject: 'ReBrew — Wholesale Application Received',
      html:    `
        <div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#EAD9B0;padding:40px;">
          <div style="background:#3B2410;padding:28px;text-align:center;margin-bottom:28px;">
            <h1 style="color:#F5EDD6;margin:0;font-size:28px;letter-spacing:0.1em;">REBREW</h1>
          </div>
          <h2 style="color:#3B2410;">Thanks for reaching out, ${vendor.contactPerson}.</h2>
          <p style="color:#5C3D1E;line-height:1.7;">
            We've received your wholesale application for <strong>${vendor.businessName}</strong>.
            Our team will review your application and get back to you within 2–3 business days.
          </p>
          <p style="color:#5C3D1E;line-height:1.7;font-style:italic;">
            "Built one step at a time." — ReBrew
          </p>
        </div>
      `,
    }).catch(err => logger.error('Vendor ack email failed:', err.message));

    // Admin notification (non-blocking)
    sendEmail({
      to:      process.env.ADMIN_EMAIL,
      subject: `[ReBrew] New Vendor Application — ${vendor.businessName}`,
      html:    `
        <h3>New Vendor Application</h3>
        <table cellpadding="8" style="border-collapse:collapse;width:100%;">
          <tr><td><strong>Business</strong></td><td>${vendor.businessName}</td></tr>
          <tr><td><strong>Contact</strong></td><td>${vendor.contactPerson}</td></tr>
          <tr><td><strong>Email</strong></td><td>${vendor.email}</td></tr>
          <tr><td><strong>Phone</strong></td><td>${vendor.phone}</td></tr>
          <tr><td><strong>Type</strong></td><td>${vendor.businessType || '—'}</td></tr>
          <tr><td><strong>City</strong></td><td>${vendor.location?.city || '—'}</td></tr>
          <tr><td><strong>Monthly Volume</strong></td><td>${vendor.estimatedMonthlyVolume || '—'} bottles</td></tr>
          <tr><td><strong>Notes</strong></td><td>${vendor.notes || '—'}</td></tr>
        </table>
        <p><a href="${process.env.BACKEND_URL}/admin/vendors/${vendor._id}">View in Admin</a></p>
      `,
    }).catch(err => logger.error('Admin vendor notification failed:', err.message));

    logger.info(`Vendor application: ${vendor.businessName} [${vendor.email}]`);

    return sendSuccess(res, {
      statusCode: 201,
      message:    'Your application has been received. We\'ll be in touch within 2–3 business days.',
      data:       { applicationId: vendor._id },
    });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   GET /admin/vendors
   Admin — list all vendor applications with filters
───────────────────────────────────────────────────────── */
exports.adminGetVendors = async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip  = (page - 1) * limit;

    const filter = {};
    if (req.query.status)       filter.status       = req.query.status;
    if (req.query.businessType) filter.businessType = req.query.businessType;
    if (req.query.search) {
      const safeSearch = String(req.query.search).slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { businessName:  { $regex: safeSearch, $options: 'i' } },
        { contactPerson: { $regex: safeSearch, $options: 'i' } },
        { email:         { $regex: safeSearch, $options: 'i' } },
      ];
    }
    const [vendors, total] = await Promise.all([
      Vendor.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('-ipAddress')
        .populate('assignedTo', 'name email')
        .lean(),
      Vendor.countDocuments(filter),
    ]);

    return sendPaginated(res, { data: vendors, total, page, limit, message: 'Vendors fetched.' });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   GET /admin/vendors/:id
   Admin — single vendor application
───────────────────────────────────────────────────────── */
exports.adminGetVendor = async (req, res, next) => {
  try {
    const vendor = await Vendor.findById(req.params.id)
      .select('-ipAddress')
      .populate('assignedTo', 'name email');

    if (!vendor) return next(new AppError('Vendor application not found.', 404));

    return sendSuccess(res, { message: 'Vendor fetched.', data: { vendor } });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   PUT /admin/vendors/:id
   Admin — update status, assign, add note
───────────────────────────────────────────────────────── */
exports.adminUpdateVendor = async (req, res, next) => {
  try {
    const { status, adminNote, assignedTo } = req.body;

    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) return next(new AppError('Vendor not found.', 404));

    const prevStatus = vendor.status;

    if (status)              vendor.status     = status;
    if (adminNote !== undefined) vendor.adminNote = adminNote;
    if (assignedTo)          vendor.assignedTo = assignedTo;

    await vendor.save();

    // Notify vendor on status changes
    if (status && status !== prevStatus) {
      const statusMessages = {
        contacted:     { subject: 'ReBrew — We\'re reviewing your application', body: 'Our team is reviewing your wholesale application and will be in touch shortly.' },
        in_discussion: { subject: 'ReBrew — Let\'s talk wholesale', body: 'We\'d love to discuss your partnership with ReBrew. Expect a call/email from our team soon.' },
        approved:      { subject: 'ReBrew — You\'re approved! 🎉', body: 'Congratulations! Your wholesale application has been approved. Welcome to the ReBrew partner network.' },
        rejected:      { subject: 'ReBrew — Application update', body: 'Thank you for your interest. At this time, we\'re unable to proceed with your application.' },
      };

      if (statusMessages[status]) {
        sendEmail({
          to:      vendor.email,
          subject: statusMessages[status].subject,
          html:    `
            <div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#EAD9B0;padding:40px;">
              <div style="background:#3B2410;padding:28px;text-align:center;margin-bottom:28px;">
                <h1 style="color:#F5EDD6;margin:0;letter-spacing:0.1em;">REBREW</h1>
              </div>
              <h2 style="color:#3B2410;">Hi ${vendor.contactPerson},</h2>
              <p style="color:#5C3D1E;line-height:1.7;">${statusMessages[status].body}</p>
              <p style="color:#5C3D1E;line-height:1.7;">Questions? Reply to this email or call us at +91 84388 17294.</p>
            </div>
          `,
        }).catch(err => logger.error('Vendor status email failed:', err.message));
      }
    }

    logger.info(
      `Vendor ${vendor.businessName} updated: status ${prevStatus} → ${vendor.status} by admin ${req.user._id}`
    );

    return sendSuccess(res, { message: 'Vendor updated.', data: { vendor } });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   DELETE /admin/vendors/:id
   Admin — delete vendor application
───────────────────────────────────────────────────────── */
exports.adminDeleteVendor = async (req, res, next) => {
  try {
    const vendor = await Vendor.findByIdAndDelete(req.params.id);
    if (!vendor) return next(new AppError('Vendor not found.', 404));

    logger.info(`Vendor deleted: ${vendor.businessName} by admin ${req.user._id}`);

    return sendSuccess(res, { message: 'Vendor application deleted.' });
  } catch (err) {
    next(err);
  }
};
