'use strict';

const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const validator= require('validator');

const userSchema = new mongoose.Schema(
  {
    name: {
      type:     String,
      required: [true, 'Name is required'],
      trim:     true,
      minlength:[2,  'Name must be at least 2 characters'],
      maxlength:[80, 'Name cannot exceed 80 characters'],
    },
    email: {
      type:     String,
      required: [true, 'Email is required'],
      unique:   true,
      lowercase:true,
      trim:     true,
      validate: {
        validator: validator.isEmail,
        message:  'Please provide a valid email address',
      },
    },
    password: {
      type:     String,
      required: [true, 'Password is required'],
      minlength:[8, 'Password must be at least 8 characters'],
      select:   false, // Never return password in queries
    },
    phone: {
      type:    String,
      trim:    true,
      validate: {
        validator: v => !v || validator.isMobilePhone(v, 'any', { strictMode: false }),
        message: 'Please provide a valid phone number',
      },
    },
    role: {
      type:    String,
      enum:    ['customer', 'admin', 'vendor'],
      default: 'customer',
    },
    isActive: {
      type:    Boolean,
      default: true,
    },
    isEmailVerified: {
      type:    Boolean,
      default: false,
    },
    emailVerificationToken:   { type: String, select: false },
    emailVerificationExpires: { type: Date,   select: false },

    passwordResetToken:   { type: String, select: false },
    passwordResetExpires: { type: Date,   select: false },
    passwordChangedAt:    { type: Date,   select: false },

    refreshToken: { type: String, select: false },

    lastLogin:  Date,
    loginCount: { type: Number, default: 0 },

    // Shipping addresses (saved)
    addresses: [
      {
        label:    { type: String, default: 'Home' },
        fullName: String,
        line1:    String,
        line2:    String,
        city:     String,
        state:    String,
        pincode:  String,
        country:  { type: String, default: 'India' },
        phone:    String,
        isDefault:{ type: Boolean, default: false },
      },
    ],
  },
  {
    timestamps: true,
    toJSON:     { virtuals: true },
    toObject:   { virtuals: true },
  }
);

// ── Indexes ───────────────────────────────────────────────
// Note: email already indexed via unique:true in schema definition above
userSchema.index({ role: 1 });
userSchema.index({ createdAt: -1 });

// ── Pre-save: Hash password ───────────────────────────────
userSchema.pre('save', async function (next) {
  // Only hash when password is new or modified
  if (!this.isModified('password')) return next();

  const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12;
  this.password = await bcrypt.hash(this.password, saltRounds);

  // Track password change time (for JWT invalidation)
  if (!this.isNew) {
    this.passwordChangedAt = Date.now() - 1000; // 1s buffer for JWT iat
  }

  next();
});

// ── Instance Methods ──────────────────────────────────────

// Compare entered password with stored hash
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Check if password changed after JWT was issued
userSchema.methods.passwordChangedAfter = function (jwtIssuedAt) {
  if (this.passwordChangedAt) {
    const changedTs = parseInt(this.passwordChangedAt.getTime() / 1000, 10);
    return changedTs > jwtIssuedAt;
  }
  return false;
};

// Generate password reset token (stored hashed, returned raw)
userSchema.methods.createPasswordResetToken = function () {
  const rawToken   = crypto.randomBytes(32).toString('hex');
  this.passwordResetToken   = crypto.createHash('sha256').update(rawToken).digest('hex');
  this.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
  return rawToken;
};

// Generate email verification token
userSchema.methods.createEmailVerificationToken = function () {
  const rawToken = crypto.randomBytes(32).toString('hex');
  this.emailVerificationToken   = crypto.createHash('sha256').update(rawToken).digest('hex');
  this.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
  return rawToken;
};

// Safe user object for API responses (no sensitive fields)
userSchema.methods.toSafeObject = function () {
  return {
    id:              this._id,
    name:            this.name,
    email:           this.email,
    phone:           this.phone,
    role:            this.role,
    isEmailVerified: this.isEmailVerified,
    isActive:        this.isActive,
    lastLogin:       this.lastLogin,
    addresses:       this.addresses,
    createdAt:       this.createdAt,
  };
};

module.exports = mongoose.model('User', userSchema);
