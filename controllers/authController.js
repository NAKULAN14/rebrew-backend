'use strict';

const crypto = require('crypto');
const User   = require('../models/User');
const { AppError, sendSuccess } = require('../utils/apiResponse');
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  setTokenCookie,
  clearTokenCookie,
} = require('../utils/jwtUtils');
const {
  sendWelcomeEmail,
  sendPasswordResetEmail,
} = require('../utils/email');
const logger = require('../utils/logger');

// ── Helper: attach tokens and respond ────────────────────
const sendAuthResponse = (res, user, statusCode = 200) => {
  const accessToken  = signAccessToken(user._id, user.role);
  const refreshToken = signRefreshToken(user._id);

  setTokenCookie(res, 'token',        accessToken);
  setTokenCookie(res, 'refreshToken', refreshToken);

  return sendSuccess(res, {
    statusCode,
    message: statusCode === 201 ? 'Account created successfully' : 'Login successful',
    data: {
      user:         user.toSafeObject(),
      accessToken,  // Also returned in body for API/mobile clients
    },
  });
};

/* ─────────────────────────────────────────────────────────
   POST /auth/register
───────────────────────────────────────────────────────── */
exports.register = async (req, res, next) => {
  try {
    const { name, email, password, phone } = req.body;

    // Check duplicate email
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return next(new AppError('An account with this email already exists.', 409));
    }

    // Create user (password hashed via pre-save hook)
    const user = await User.create({ name, email, password, phone });

    // Generate email verification token
    const verifyToken = user.createEmailVerificationToken();
    await user.save({ validateBeforeSave: false });

    // Fire-and-forget welcome email (don't fail registration if email fails)
    sendWelcomeEmail(user).catch(err =>
      logger.error('Welcome email failed:', err.message)
    );

    logger.info(`New user registered: ${user.email} [${user._id}]`);

    return sendAuthResponse(res, user, 201);
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   POST /auth/login
───────────────────────────────────────────────────────── */
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Fetch user including password (select: false by default)
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');

    // Generic message prevents email enumeration
    const authFailMsg = 'Invalid email or password.';

    if (!user) return next(new AppError(authFailMsg, 401));

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) return next(new AppError(authFailMsg, 401));

    // Check account status
    if (!user.isActive) {
      return next(new AppError('Your account has been deactivated. Contact support.', 403));
    }

    // Update last login stats
    user.lastLogin  = new Date();
    user.loginCount = (user.loginCount || 0) + 1;
    await user.save({ validateBeforeSave: false });

    logger.info(`User logged in: ${user.email} [${user._id}] from IP ${req.ip}`);

    return sendAuthResponse(res, user);
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   POST /auth/logout
───────────────────────────────────────────────────────── */
exports.logout = async (req, res, next) => {
  try {
    // Clear refresh token from DB if stored
    if (req.user) {
      await User.findByIdAndUpdate(req.user._id, { $unset: { refreshToken: 1 } });
    }

    clearTokenCookie(res, 'token');
    clearTokenCookie(res, 'refreshToken');

    return sendSuccess(res, { message: 'Logged out successfully.' });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   POST /auth/refresh-token
───────────────────────────────────────────────────────── */
exports.refreshToken = async (req, res, next) => {
  try {
    const token = req.cookies?.refreshToken || req.body?.refreshToken;
    if (!token) return next(new AppError('Refresh token is required.', 401));

    let decoded;
    try {
      decoded = verifyRefreshToken(token);
    } catch {
      return next(new AppError('Invalid or expired refresh token. Please log in again.', 401));
    }

    const user = await User.findById(decoded.id);
    if (!user || !user.isActive) {
      return next(new AppError('User not found or account inactive.', 401));
    }

    const newAccessToken  = signAccessToken(user._id, user.role);
    const newRefreshToken = signRefreshToken(user._id);

    setTokenCookie(res, 'token',        newAccessToken);
    setTokenCookie(res, 'refreshToken', newRefreshToken);

    return sendSuccess(res, {
      message: 'Token refreshed.',
      data:    { accessToken: newAccessToken },
    });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   GET /auth/profile
───────────────────────────────────────────────────────── */
exports.getProfile = async (req, res, next) => {
  try {
    // Re-fetch to ensure fresh data (req.user cached at auth time)
    const user = await User.findById(req.user._id);
    if (!user) return next(new AppError('User not found.', 404));

    return sendSuccess(res, {
      message: 'Profile fetched.',
      data:    { user: user.toSafeObject() },
    });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   PUT /auth/profile
───────────────────────────────────────────────────────── */
exports.updateProfile = async (req, res, next) => {
  try {
    // Explicitly whitelist updatable fields — never allow role/password here
    const { name, phone } = req.body;
    const updates = {};
    if (name  !== undefined) updates.name  = name;
    if (phone !== undefined) updates.phone = phone;

    if (Object.keys(updates).length === 0) {
      return next(new AppError('No valid fields provided for update.', 400));
    }

    const user = await User.findByIdAndUpdate(req.user._id, updates, {
      new:            true,
      runValidators:  true,
    });

    return sendSuccess(res, {
      message: 'Profile updated.',
      data:    { user: user.toSafeObject() },
    });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   PUT /auth/update-password
───────────────────────────────────────────────────────── */
exports.updatePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user._id).select('+password');
    if (!user) return next(new AppError('User not found.', 404));

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return next(new AppError('Current password is incorrect.', 401));
    }

    if (currentPassword === newPassword) {
      return next(new AppError('New password must be different from current password.', 400));
    }

    user.password = newPassword;
    await user.save();

    // Invalidate existing sessions by issuing fresh tokens
    clearTokenCookie(res, 'token');
    clearTokenCookie(res, 'refreshToken');

    logger.info(`Password changed for user: ${user.email}`);

    return sendSuccess(res, { message: 'Password updated. Please log in again.' });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   POST /auth/forgot-password
───────────────────────────────────────────────────────── */
exports.forgotPassword = async (req, res, next) => {
  try {
    const user = await User.findOne({ email: req.body.email.toLowerCase() });

    // Always return success — prevents email enumeration
    const genericMessage = 'If an account with that email exists, a reset link has been sent.';

    if (!user) {
      // Deliberate timing-safe delay
      await new Promise(r => setTimeout(r, 1000));
      return sendSuccess(res, { message: genericMessage });
    }

    const rawToken = user.createPasswordResetToken();
    await user.save({ validateBeforeSave: false });

    try {
      await sendPasswordResetEmail(user, rawToken);
      logger.info(`Password reset token sent to: ${user.email}`);
    } catch (emailErr) {
      // Rollback token if email fails
      user.passwordResetToken   = undefined;
      user.passwordResetExpires = undefined;
      await user.save({ validateBeforeSave: false });
      logger.error('Password reset email failed:', emailErr.message);
      return next(new AppError('Email could not be sent. Please try again later.', 500));
    }

    return sendSuccess(res, { message: genericMessage });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   POST /auth/reset-password
───────────────────────────────────────────────────────── */
exports.resetPassword = async (req, res, next) => {
  try {
    const { token, password } = req.body;

    // Hash the raw token to compare with stored hash
    const hashedToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    const user = await User.findOne({
      passwordResetToken:   hashedToken,
      passwordResetExpires: { $gt: Date.now() }, // Token not expired
    });

    if (!user) {
      return next(new AppError('Invalid or expired reset token.', 400));
    }

    // Set new password and clear reset fields
    user.password             = password;
    user.passwordResetToken   = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    clearTokenCookie(res, 'token');
    clearTokenCookie(res, 'refreshToken');

    logger.info(`Password reset for: ${user.email}`);

    return sendSuccess(res, { message: 'Password reset successful. Please log in.' });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   POST /auth/addresses
───────────────────────────────────────────────────────── */
exports.addAddress = async (req, res, next) => {
  try {
    const { label, fullName, line1, line2, city, state, pincode, phone, isDefault } = req.body;

    const user = await User.findById(req.user._id);

    // If this is set as default, unset all others first
    if (isDefault) {
      user.addresses.forEach(addr => { addr.isDefault = false; });
    }

    user.addresses.push({ label, fullName, line1, line2, city, state, pincode, phone, isDefault });
    await user.save({ validateBeforeSave: false });

    return sendSuccess(res, {
      statusCode: 201,
      message:    'Address added.',
      data:       { addresses: user.addresses },
    });
  } catch (err) {
    next(err);
  }
};

/* ─────────────────────────────────────────────────────────
   DELETE /auth/addresses/:addressId
───────────────────────────────────────────────────────── */
exports.removeAddress = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    const { addressId } = req.params;

    const addrIndex = user.addresses.findIndex(a => a._id.toString() === addressId);
    if (addrIndex === -1) return next(new AppError('Address not found.', 404));

    user.addresses.splice(addrIndex, 1);
    await user.save({ validateBeforeSave: false });

    return sendSuccess(res, {
      message: 'Address removed.',
      data:    { addresses: user.addresses },
    });
  } catch (err) {
    next(err);
  }
};
