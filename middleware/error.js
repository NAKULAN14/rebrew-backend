'use strict';

const logger    = require('../utils/logger');
const { AppError } = require('../utils/apiResponse');

// ── Handle specific Mongoose / JWT errors ─────────────────
const handleCastError = (err) =>
  new AppError(`Invalid ${err.path}: ${err.value}`, 400);

const handleDuplicateKeyError = (err) => {
  const field = Object.keys(err.keyValue)[0];
  const value = err.keyValue[field];
  return new AppError(`${field} '${value}' already exists. Please use a different value.`, 409);
};

const handleValidationError = (err) => {
  const messages = Object.values(err.errors).map(e => e.message);
  return new AppError(`Validation failed: ${messages.join('. ')}`, 422);
};

const handleJWTError = () =>
  new AppError('Invalid token. Please log in again.', 401);

const handleJWTExpiredError = () =>
  new AppError('Session expired. Please log in again.', 401);

const handleMulterError = (err) => {
  if (err.code === 'LIMIT_FILE_SIZE')  return new AppError('File size exceeds the 5MB limit.', 413);
  if (err.code === 'LIMIT_FILE_COUNT') return new AppError('Too many files uploaded.', 413);
  return new AppError(`File upload error: ${err.message}`, 400);
};

// ── Development error response (includes stack trace) ─────
const sendErrorDev = (err, res) => {
  res.status(err.statusCode).json({
    success:   false,
    status:    err.status,
    message:   err.message,
    stack:     err.stack,
    error:     err,
  });
};

// ── Production error response (operational errors only) ───
const sendErrorProd = (err, res) => {
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
    });
  }

  console.error("========== ERROR ==========");
  console.error(err);
  console.error(err.stack);

  return res.status(err.statusCode || 500).json({
    success: false,
    message: "Something went wrong. Please try again later."
  });
};

// ── Main error middleware ─────────────────────────────────
const errorMiddleware = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status     = err.status     || 'error';

  // Log all errors (with request context)
  const logLevel = err.statusCode >= 500 ? 'error' : 'warn';
  logger[logLevel](`${req.method} ${req.originalUrl} — ${err.statusCode}: ${err.message}`);

  let error = { ...err, message: err.message };

  // Transform known error types into AppErrors
  if (err.name === 'CastError')              error = handleCastError(err);
  if (err.code === 11000)                    error = handleDuplicateKeyError(err);
  if (err.name === 'ValidationError')        error = handleValidationError(err);
  if (err.name === 'JsonWebTokenError')      error = handleJWTError();
  if (err.name === 'TokenExpiredError')      error = handleJWTExpiredError();
  if (err.name === 'MulterError')            error = handleMulterError(err);

  if (process.env.NODE_ENV === 'development') {
    sendErrorDev(error, res);
  } else {
    sendErrorProd(error, res);
  }
};

// ── 404 handler (must be registered before errorMiddleware) ─
const notFoundMiddleware = (req, res, next) => {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404));
};

module.exports = { errorMiddleware, notFoundMiddleware };
