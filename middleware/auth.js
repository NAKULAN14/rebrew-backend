'use strict';

const User                              = require('../models/User');
const { verifyAccessToken, extractToken } = require('../utils/jwtUtils');
const { AppError }                      = require('../utils/apiResponse');
const logger                            = require('../utils/logger');

// ── Protect route — must be authenticated ─────────────────
const protect = async (req, res, next) => {
  try {
    // 1. Extract token
    const token = extractToken(req);
    if (!token) {
      return next(new AppError('Authentication required. Please log in.', 401));
    }

    // 2. Verify token
    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return next(new AppError('Session expired. Please log in again.', 401));
      }
      if (err.name === 'JsonWebTokenError') {
        return next(new AppError('Invalid token. Please log in again.', 401));
      }
      return next(new AppError('Authentication failed.', 401));
    }

    // 3. Check user still exists
    const user = await User.findById(decoded.id).select('+passwordChangedAt');
    if (!user) {
      return next(new AppError('The account associated with this token no longer exists.', 401));
    }

    // 4. Check if account is active
    if (!user.isActive) {
      return next(new AppError('Your account has been deactivated. Contact support.', 401));
    }

    // 5. Check if password changed after token was issued
    if (user.passwordChangedAfter(decoded.iat)) {
      return next(new AppError('Password was recently changed. Please log in again.', 401));
    }

    // 6. Attach user to request
    req.user = user;
    next();
  } catch (err) {
    logger.error('Auth middleware error:', err.message);
    next(new AppError('Authentication error.', 500));
  }
};

// ── Optional auth — attach user if token present, else continue ─
const optionalAuth = async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) return next();

    const decoded = verifyAccessToken(token);
    const user    = await User.findById(decoded.id);
    if (user && user.isActive) req.user = user;
    next();
  } catch {
    // Token invalid — just continue unauthenticated
    next();
  }
};

// ── Role authorization factory ────────────────────────────
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('Authentication required.', 401));
    }
    if (!roles.includes(req.user.role)) {
      return next(
        new AppError(
          `Access denied. This resource requires one of: ${roles.join(', ')}`,
          403
        )
      );
    }
    next();
  };
};

// ── Shorthand role guards ─────────────────────────────────
const adminOnly  = authorize('admin');
const vendorOnly = authorize('admin', 'vendor');
const staffOnly  = authorize('admin', 'vendor');

module.exports = { protect, optionalAuth, authorize, adminOnly, vendorOnly, staffOnly };
