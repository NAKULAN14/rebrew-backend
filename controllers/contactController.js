'use strict';

const { Contact }   = require('../models/index');
const { AppError, sendSuccess, sendPaginated } = require('../utils/apiResponse');
const { sendContactAcknowledgement, sendAdminContactNotification } = require('../utils/email');
const whatsapp = require('../services/whatsappService');
const logger        = require('../utils/logger');

/* ─────────────────────────────────────────────────────────
   POST /contact
   Public — submit contact enquiry
───────────────────────────────────────────────────────── */
exports.submitContact = async (req, res, next) => {
  try {
    const { name, email, phone, organisation, enquiryType, message } = req.body;

    const contact = await Contact.create({
      name,
      email:        email.toLowerCase(),
      phone,
      organisation,
      enquiryType:  enquiryType || 'general',
      message,
      ipAddress:    req.ip,
    });

    // Send acknowledgement to submitter (non-blocking)
    sendContactAcknowledgement(contact).catch(err =>
      logger.error('Contact ack email failed:', err.message)
    );

    // Notify admin (non-blocking) — uses centralized branded template
    sendAdminContactNotification(contact)
      .catch(err => logger.error('Admin contact notification failed:', err.message));

    logger.info(`Contact submitted: ${contact.email} [type: ${contact.enquiryType}]`);

    // WhatsApp admin notification — fire-and-forget, never blocks contact submission
    whatsapp.notifyNewContact(contact)
      .catch(err => logger.error('WhatsApp contact notify failed:', err.message));

    return sendSuccess(res, {
      statusCode: 201,
      message:    'Your message has been received. We\'ll be in touch within 24 hours.',
      data:       { contactId: contact._id },
    });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   GET /admin/contacts
   Admin — list all contacts with filters
───────────────────────────────────────────────────────── */
exports.adminGetContacts = async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip  = (page - 1) * limit;

    const filter = {};
    if (req.query.status)      filter.status      = req.query.status;
    if (req.query.enquiryType) filter.enquiryType = req.query.enquiryType;
    if (req.query.search) {
      const safeSearch = String(req.query.search).slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name:    { $regex: safeSearch, $options: 'i' } },
        { email:   { $regex: safeSearch, $options: 'i' } },
        { message: { $regex: safeSearch, $options: 'i' } },
      ];
    }
    const [contacts, total] = await Promise.all([
      Contact.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('-ipAddress')
        .lean(),
      Contact.countDocuments(filter),
    ]);

    return sendPaginated(res, { data: contacts, total, page, limit, message: 'Contacts fetched.' });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   GET /admin/contacts/:id
   Admin — single contact detail
───────────────────────────────────────────────────────── */
exports.adminGetContact = async (req, res, next) => {
  try {
    const contact = await Contact.findById(req.params.id).select('-ipAddress');
    if (!contact) return next(new AppError('Contact not found.', 404));

    // Auto-mark as read when admin views
    if (contact.status === 'new') {
      contact.status = 'read';
      await contact.save();
    }

    return sendSuccess(res, { message: 'Contact fetched.', data: { contact } });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   PUT /admin/contacts/:id
   Admin — update status / add note
───────────────────────────────────────────────────────── */
exports.adminUpdateContact = async (req, res, next) => {
  try {
    const { status, adminNote } = req.body;

    const contact = await Contact.findById(req.params.id);
    if (!contact) return next(new AppError('Contact not found.', 404));

    if (status)    contact.status    = status;
    if (adminNote !== undefined) contact.adminNote = adminNote;

    if (status === 'replied') contact.repliedAt = new Date();

    await contact.save();

    return sendSuccess(res, { message: 'Contact updated.', data: { contact } });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   DELETE /admin/contacts/:id
   Admin — delete contact record
───────────────────────────────────────────────────────── */
exports.adminDeleteContact = async (req, res, next) => {
  try {
    const contact = await Contact.findByIdAndDelete(req.params.id);
    if (!contact) return next(new AppError('Contact not found.', 404));

    logger.info(`Contact deleted: ${contact.email} by admin ${req.user._id}`);

    return sendSuccess(res, { message: 'Contact deleted.' });
  } catch (err) {
    next(err);
  }
};
