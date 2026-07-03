'use strict';

// ============================================================
// API RESPONSE HELPERS
// All responses follow: { success, message, data, meta }
// ============================================================

/**
 * Send a successful response
 */
const sendSuccess = (res, { statusCode = 200, message = 'Success', data = null, meta = null } = {}) => {
  const payload = { success: true, message };
  if (data !== null)  payload.data = data;
  if (meta !== null)  payload.meta = meta;
  return res.status(statusCode).json(payload);
};

/**
 * Send an error response (used by error middleware, but available standalone)
 */
const sendError = (res, { statusCode = 500, message = 'Internal server error', errors = null } = {}) => {
  const payload = { success: false, message };
  if (errors !== null) payload.errors = errors;
  if (process.env.NODE_ENV === 'development') {
    // Include stack trace in dev
  }
  return res.status(statusCode).json(payload);
};

/**
 * Paginated response helper
 */
const sendPaginated = (res, { data, total, page, limit, message = 'Success' }) => {
  const totalPages  = Math.ceil(total / limit);
  return res.status(200).json({
    success: true,
    message,
    data,
    meta: {
      total,
      page:       parseInt(page),
      limit:      parseInt(limit),
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  });
};

module.exports = { sendSuccess, sendError, sendPaginated };


// ============================================================
// APP ERROR CLASS — Operational errors (safe to send to client)
// ============================================================
// Exported separately as AppError

class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode  = statusCode;
    this.status      = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true; // Mark as safe-to-expose error

    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports.AppError = AppError;
