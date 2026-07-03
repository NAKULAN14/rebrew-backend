'use strict';

const rateLimit  = require('express-rate-limit');
const slowDown   = require('express-slow-down');
const { AppError } = require('../utils/apiResponse');

// ── Rate limiter store ────────────────────────────────────
// Default: in-memory. Works correctly for single-process deployments.
// For PM2 cluster mode (multiple workers), each worker has its own counter —
// effective limit = max × workers. To fix, install 'rate-limit-redis' and
// set the store option:
//   const RedisStore = require('rate-limit-redis');
//   store: new RedisStore({ sendCommand: (...args) => redisClient.sendCommand(args) })
// Until Redis is configured, run PM2 with --instances 1 to avoid this issue.

// ── Standard API Rate Limiter ─────────────────────────────
// 100 requests per 15 minutes per IP
const apiLimiter = rateLimit({
  windowMs:         parseInt(process.env.RATE_LIMIT_WINDOW_MS)   || 15 * 60 * 1000,
  max:              parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  standardHeaders:  true,   // Return rate limit info in `RateLimit-*` headers
  legacyHeaders:    false,
  skipSuccessfulRequests: false,
  handler: (req, res, next, options) => {
    next(new AppError('Too many requests. Please try again later.', 429));
  },
  keyGenerator: (req) => req.ip,
});

// ── Strict Auth Rate Limiter ──────────────────────────────
// 10 login attempts per 15 minutes per IP — brute force protection
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      parseInt(process.env.AUTH_RATE_LIMIT_MAX) || 10,
  standardHeaders: true,
  legacyHeaders:   false,
  skipSuccessfulRequests: true, // Don't count successful logins
  handler: (req, res, next) => {
    next(new AppError('Too many login attempts. Please try again in 15 minutes.', 429));
  },
});

// ── Password reset rate limiter ───────────────────────────
// 3 per hour
const passwordResetLimiter = rateLimit({
  windowMs:  60 * 60 * 1000, // 1 hour
  max:       3,
  standardHeaders: true,
  legacyHeaders:   false,
  handler: (req, res, next) => {
    next(new AppError('Too many password reset requests. Please wait an hour.', 429));
  },
});

// ── Payment rate limiter ──────────────────────────────────
// 20 checkout attempts per hour per IP
const paymentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max:      20,
  standardHeaders: true,
  legacyHeaders:   false,
  handler: (req, res, next) => {
    next(new AppError('Too many payment requests. Please try again later.', 429));
  },
});

// ── Contact / newsletter limiter ──────────────────────────
// 5 per hour
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max:      5,
  standardHeaders: true,
  legacyHeaders:   false,
  handler: (req, res, next) => {
    next(new AppError('Too many submissions. Please wait before trying again.', 429));
  },
});

// ── Speed limiter (slow down repeated requests) ───────────
const speedLimiter = slowDown({
  windowMs:          15 * 60 * 1000,
  delayAfter:        50,  // Start slowing after 50 requests
  delayMs:           () => 200, // Add 200ms per request after threshold
  maxDelayMs:        2000,      // Max 2s delay
});

module.exports = {
  apiLimiter,
  authLimiter,
  passwordResetLimiter,
  paymentLimiter,
  contactLimiter,
  speedLimiter,
};
