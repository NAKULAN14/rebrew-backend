'use strict';

const crypto             = require('crypto');
const { Newsletter }     = require('../models/index');
const { AppError, sendSuccess, sendPaginated } = require('../utils/apiResponse');
const { sendEmail }      = require('../utils/email');
const logger             = require('../utils/logger');

/* ─────────────────────────────────────────────────────────
   POST /newsletter
   Public — subscribe to newsletter
───────────────────────────────────────────────────────── */
exports.subscribe = async (req, res, next) => {
  try {
    const { email, name, source } = req.body;
    const normalizedEmail = email.toLowerCase().trim();

    const existing = await Newsletter.findOne({ email: normalizedEmail });

    if (existing) {
      if (existing.isActive) {
        // Already subscribed — don't leak this info to prevent enumeration
        return sendSuccess(res, {
          message: 'You\'re on the list. Welcome to the ReBrew circle.',
        });
      }
      // Re-subscribe
      existing.isActive       = true;
      existing.unsubscribedAt = undefined;
      existing.name           = name || existing.name;
      existing.source         = source || existing.source;
      await existing.save();

      logger.info(`Newsletter re-subscribed: ${normalizedEmail}`);

      return sendSuccess(res, {
        message: 'Welcome back to the ReBrew circle.',
      });
    }

    // Generate unsubscribe token
    const unsubscribeToken = crypto.randomBytes(32).toString('hex');

    await Newsletter.create({
      email:            normalizedEmail,
      name:             name || '',
      source:           source || 'website',
      isActive:         true,
      unsubscribeToken: unsubscribeToken,
      ipAddress:        req.ip,
    });

    // Send welcome email (non-blocking)
    sendEmail({
      to:      normalizedEmail,
      subject: 'Welcome to the ReBrew Journal ✦',
      html:    `
        <div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#EAD9B0;padding:40px;">
          <div style="background:#3B2410;padding:28px;text-align:center;margin-bottom:28px;">
            <h1 style="color:#F5EDD6;margin:0;font-size:28px;letter-spacing:0.1em;">REBREW</h1>
          </div>
          <h2 style="color:#3B2410;">You're on the list${name ? `, ${name}` : ''}.</h2>
          <p style="color:#5C3D1E;line-height:1.7;">
            New flavours, events, and stories from the brewery — delivered straight to your inbox.
            No noise. Just craft.
          </p>
          <p style="color:#5C3D1E;font-style:italic;line-height:1.7;">"Time makes it wild." — ReBrew</p>
          <p style="margin-top:32px;font-size:11px;color:rgba(92,61,30,0.4);">
            <a href="${process.env.FRONTEND_URL}/unsubscribe?token=${unsubscribeToken}" style="color:rgba(92,61,30,0.4);">
              Unsubscribe
            </a>
          </p>
        </div>
      `,
    }).catch(err => logger.error('Newsletter welcome email failed:', err.message));

    logger.info(`Newsletter subscribed: ${normalizedEmail}`);

    return sendSuccess(res, {
      statusCode: 201,
      message:    'You\'re on the list. Welcome to the ReBrew circle.',
    });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   POST /newsletter/unsubscribe
   Public — unsubscribe via token (from email link)
───────────────────────────────────────────────────────── */
exports.unsubscribe = async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token) return next(new AppError('Unsubscribe token is required.', 400));

    const subscriber = await Newsletter.findOne({ unsubscribeToken: token }).select('+unsubscribeToken');

    if (!subscriber) {
      return next(new AppError('Invalid unsubscribe token.', 404));
    }

    subscriber.isActive       = false;
    subscriber.unsubscribedAt = new Date();
    await subscriber.save();

    logger.info(`Newsletter unsubscribed: ${subscriber.email}`);

    return sendSuccess(res, { message: 'You\'ve been unsubscribed. We\'ll miss you.' });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   GET /admin/newsletter
   Admin — list subscribers
───────────────────────────────────────────────────────── */
exports.adminGetSubscribers = async (req, res, next) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(200, parseInt(req.query.limit) || 50);
    const skip   = (page - 1) * limit;

    const filter = {};
    if (req.query.active !== undefined) {
      filter.isActive = req.query.active === 'true';
    }
    if (req.query.source) filter.source = req.query.source;
    if (req.query.search) {
      const safeSearch = String(req.query.search).slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { email: { $regex: safeSearch, $options: 'i' } },
        { name:  { $regex: safeSearch, $options: 'i' } },
      ];
    }
    const [subscribers, total] = await Promise.all([
      Newsletter.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('-unsubscribeToken -ipAddress')
        .lean(),
      Newsletter.countDocuments(filter),
    ]);

    // Stats
    const [activeCount, inactiveCount] = await Promise.all([
      Newsletter.countDocuments({ isActive: true }),
      Newsletter.countDocuments({ isActive: false }),
    ]);

    return sendPaginated(res, {
      data: subscribers, total, page, limit,
      message: 'Subscribers fetched.',
    });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   POST /admin/newsletter/broadcast
   Admin — send broadcast email to all active subscribers
───────────────────────────────────────────────────────── */
exports.adminBroadcast = async (req, res, next) => {
  try {
    const { subject, htmlContent, tags } = req.body;

    if (!subject || !htmlContent) {
      return next(new AppError('Subject and HTML content are required.', 400));
    }

    const filter = { isActive: true };
    if (tags?.length) filter.tags = { $in: tags };

    const subscribers = await Newsletter.find(filter)
      .select('email name unsubscribeToken')
      .lean();

    if (subscribers.length === 0) {
      return next(new AppError('No active subscribers found.', 404));
    }

    logger.info(
      `Admin broadcast initiated: "${subject}" to ${subscribers.length} subscribers by ${req.user._id}`
    );

    // Send in batches of 50 to avoid SMTP throttling
    const BATCH_SIZE = 50;
    let sent = 0;
    let failed = 0;

    for (let i = 0; i < subscribers.length; i += BATCH_SIZE) {
      const batch = subscribers.slice(i, i + BATCH_SIZE);

      const emailPromises = batch.map(async (sub) => {
        const personalised = htmlContent.replace(/{{name}}/g, sub.name || 'there');
        const unsubUrl = `${process.env.FRONTEND_URL}/unsubscribe?token=${sub.unsubscribeToken}`;

        try {
          await sendEmail({
            to:      sub.email,
            subject,
            html:    personalised + `
              <p style="margin-top:40px;font-size:11px;color:rgba(92,61,30,0.4);">
                <a href="${unsubUrl}" style="color:rgba(92,61,30,0.4);">Unsubscribe</a>
              </p>`,
          });
          sent++;
        } catch {
          failed++;
        }
      });

      await Promise.allSettled(emailPromises);

      // Small delay between batches
      if (i + BATCH_SIZE < subscribers.length) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    logger.info(`Broadcast complete: ${sent} sent, ${failed} failed`);

    return sendSuccess(res, {
      message: `Broadcast sent to ${sent} subscribers. ${failed} failed.`,
      data:    { sent, failed, total: subscribers.length },
    });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   DELETE /admin/newsletter/:id
   Admin — remove subscriber record
───────────────────────────────────────────────────────── */
exports.adminDeleteSubscriber = async (req, res, next) => {
  try {
    const sub = await Newsletter.findByIdAndDelete(req.params.id);
    if (!sub) return next(new AppError('Subscriber not found.', 404));

    logger.info(`Subscriber deleted: ${sub.email} by admin ${req.user._id}`);

    return sendSuccess(res, { message: 'Subscriber removed.' });
  } catch (err) {
    next(err);
  }
};
