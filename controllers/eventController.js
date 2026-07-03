'use strict';

const { Event }   = require('../models/index');
const { AppError, sendSuccess, sendPaginated } = require('../utils/apiResponse');
const { deleteImage } = require('../config/cloudinary');
const logger      = require('../utils/logger');

/* ─────────────────────────────────────────────────────────
   GET /events
   Public — upcoming events (default), or all with ?filter
───────────────────────────────────────────────────────── */
exports.getEvents = async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 12);
    const skip  = (page - 1) * limit;

    const filter = { isPublished: true };

    // Default: upcoming events only
    if (req.query.period === 'past') {
      filter.date = { $lt: new Date() };
    } else if (req.query.period === 'all') {
      // No date filter
    } else {
      filter.date = { $gte: new Date() };
    }

    if (req.query.eventType) filter.eventType = req.query.eventType;
    if (req.query.city)      filter['location.city'] = { $regex: req.query.city, $options: 'i' };
    if (req.query.featured)  filter.isFeatured = true;

    const sortOrder = req.query.period === 'past' ? { date: -1 } : { date: 1 };

    const [events, total] = await Promise.all([
      Event.find(filter)
        .sort(sortOrder)
        .skip(skip)
        .limit(limit)
        .lean(),
      Event.countDocuments(filter),
    ]);

    return sendPaginated(res, { data: events, total, page, limit, message: 'Events fetched.' });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   GET /events/:id
   Public — single event by ID or slug
───────────────────────────────────────────────────────── */
exports.getEvent = async (req, res, next) => {
  try {
    const { id } = req.params;
    const isMongoId = /^[a-f\d]{24}$/i.test(id);
    const query     = isMongoId ? { _id: id } : { slug: id };

    const event = await Event.findOne({ ...query, isPublished: true }).lean();
    if (!event) return next(new AppError('Event not found.', 404));

    return sendSuccess(res, { message: 'Event fetched.', data: { event } });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   POST /admin/events
   Admin only — create event
───────────────────────────────────────────────────────── */
exports.adminCreateEvent = async (req, res, next) => {
  try {
    const {
      title, description, location, date, endDate,
      time, eventType, entryFee, isFeatured, isPublished,
      rsvpLink, tags,
    } = req.body;

    const eventData = {
      title, description, location,
      date:        new Date(date),
      endDate:     endDate ? new Date(endDate) : undefined,
      time, eventType,
      entryFee:    entryFee ? parseFloat(entryFee) : 0,
      isFeatured:  isFeatured === 'true' || isFeatured === true,
      isPublished: isPublished !== 'false' && isPublished !== false,
      rsvpLink,
      tags:        Array.isArray(tags) ? tags : (tags ? [tags] : []),
    };

    // Handle uploaded image
    if (req.file) {
      eventData.image = {
        url:      req.file.path,
        publicId: req.file.filename,
        alt:      `ReBrew Event — ${title}`,
      };
    }

    const event = await Event.create(eventData);

    logger.info(`Event created: "${event.title}" [${event._id}] by admin ${req.user._id}`);

    return sendSuccess(res, {
      statusCode: 201,
      message:    'Event created.',
      data:       { event },
    });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   PUT /admin/events/:id
   Admin only — update event
───────────────────────────────────────────────────────── */
exports.adminUpdateEvent = async (req, res, next) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return next(new AppError('Event not found.', 404));

    const allowedFields = [
      'title', 'description', 'location', 'time', 'eventType',
      'entryFee', 'isFeatured', 'isPublished', 'rsvpLink', 'tags',
    ];

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) event[field] = req.body[field];
    });

    if (req.body.date)    event.date    = new Date(req.body.date);
    if (req.body.endDate) event.endDate = new Date(req.body.endDate);

    // Handle new image upload
    if (req.file) {
      // Delete old image from Cloudinary
      if (event.image?.publicId) {
        await deleteImage(event.image.publicId).catch(err =>
          logger.error('Cloudinary event image delete failed:', err.message)
        );
      }
      event.image = {
        url:      req.file.path,
        publicId: req.file.filename,
        alt:      `ReBrew Event — ${event.title}`,
      };
    }

    await event.save();

    logger.info(`Event updated: "${event.title}" [${event._id}] by admin ${req.user._id}`);

    return sendSuccess(res, { message: 'Event updated.', data: { event } });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   DELETE /admin/events/:id
   Admin only — delete event
───────────────────────────────────────────────────────── */
exports.adminDeleteEvent = async (req, res, next) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return next(new AppError('Event not found.', 404));

    // Delete image from Cloudinary
    if (event.image?.publicId) {
      await deleteImage(event.image.publicId).catch(err =>
        logger.error('Cloudinary event image delete failed:', err.message)
      );
    }

    await event.deleteOne();

    logger.info(`Event deleted: "${event.title}" [${event._id}] by admin ${req.user._id}`);

    return sendSuccess(res, { message: 'Event deleted.' });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   GET /admin/events
   Admin — all events including unpublished
───────────────────────────────────────────────────────── */
exports.adminGetEvents = async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip  = (page - 1) * limit;

    const filter = {};
    if (req.query.isPublished !== undefined) filter.isPublished = req.query.isPublished === 'true';
    if (req.query.eventType)  filter.eventType = req.query.eventType;

    const [events, total] = await Promise.all([
      Event.find(filter).sort({ date: -1 }).skip(skip).limit(limit).lean(),
      Event.countDocuments(filter),
    ]);

    return sendPaginated(res, { data: events, total, page, limit, message: 'Events fetched.' });
  } catch (err) {
    next(err);
  }
};
