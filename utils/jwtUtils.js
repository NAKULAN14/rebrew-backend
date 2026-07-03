'use strict';

const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const logger = require('./logger');

// ── Sign access token ─────────────────────────────────────
const signAccessToken = (userId, role) => {
  return jwt.sign(
    { id: userId, role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d', issuer: 'rebrew-api' }
  );
};

// ── Sign refresh token ────────────────────────────────────
const signRefreshToken = (userId) => {
  return jwt.sign(
    { id: userId, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d', issuer: 'rebrew-api' }
  );
};

// ── Verify access token ───────────────────────────────────
const verifyAccessToken = (token) => {
  return jwt.verify(token, process.env.JWT_SECRET, { issuer: 'rebrew-api' });
};

// ── Verify refresh token ──────────────────────────────────
const verifyRefreshToken = (token) => {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET, { issuer: 'rebrew-api' });
};

// ── Set JWT as HTTP-only cookie ───────────────────────────
const setTokenCookie = (res, name, token) => {
  const isProduction  = process.env.NODE_ENV === 'production';
  const expiresInDays = parseInt(process.env.JWT_COOKIE_EXPIRES_IN) || 7;

  res.cookie(name, token, {
    httpOnly: true,               // Not accessible via JS
    secure:   isProduction,       // HTTPS only in production
    sameSite: isProduction ? 'Strict' : 'Lax',
    maxAge:   expiresInDays * 24 * 60 * 60 * 1000,
    path:     '/',
  });
};

// ── Clear token cookie ────────────────────────────────────
const clearTokenCookie = (res, name = 'token') => {
  res.clearCookie(name, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'Strict' : 'Lax',
    path:     '/',
  });
};

// ── Extract token from request ────────────────────────────
const extractToken = (req) => {
  // 1. Authorization header: "Bearer <token>"
  if (req.headers.authorization?.startsWith('Bearer ')) {
    return req.headers.authorization.split(' ')[1];
  }
  // 2. Cookie
  if (req.cookies?.token) {
    return req.cookies.token;
  }
  return null;
};

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  setTokenCookie,
  clearTokenCookie,
  extractToken,
};
