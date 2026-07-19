'use strict';

const express      = require('express');
const helmet       = require('helmet');
const cors         = require('cors');
const mongoSanitize= require('express-mongo-sanitize');
const xss          = require('xss-clean');
const hpp          = require('hpp');
const compression  = require('compression');
const cookieParser = require('cookie-parser');
const morgan       = require('morgan');
const path         = require('path');

const { apiLimiter, speedLimiter } = require('./middleware/rateLimiter');
const { errorMiddleware, notFoundMiddleware } = require('./middleware/error');
const logger       = require('./utils/logger');

const app = express();

// ── Trust proxy (Hostinger VPS behind nginx) ──────────────
app.set('trust proxy', 1);

// ── Security: Helmet (sets secure HTTP headers) ───────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", 'data:', 'https://res.cloudinary.com'],
      connectSrc: ["'self'"],
    },
  },
  crossOriginResourcePolicy: { policy: 'same-site' },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
}));

// ── CORS ──────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile apps, Postman, curl)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    logger.warn(`CORS blocked origin: ${origin}`);
    cb(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials:      true,
  methods:          ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders:   ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders:   ['RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset'],
  maxAge:           86400, // Pre-flight cache: 24h
}));

// ── Razorpay webhook ──────────────────────────────────────
// Razorpay sends standard JSON — no raw body needed.
// Registered before express.json() for explicit ordering,
// but express.json() parses it fine.
// Signature verified inside the controller using
// razorpay.webhooks.validateWebhookSignature().

// ── Body Parsers ──────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));       // Reject oversized JSON
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

// ── Security: Input sanitization ──────────────────────────
// Strip $ and . from req.body, req.query, req.params (MongoDB injection)
app.use(mongoSanitize({
  replaceWith: '_',
  allowDots:   false,
}));

// Sanitize user input against XSS attacks
app.use(xss());

// Prevent HTTP Parameter Pollution
app.use(hpp({
  whitelist: ['sort', 'flavor', 'page', 'limit', 'price', 'status'],
}));

// ── Compression ───────────────────────────────────────────
app.use(compression());

// ── HTTP Request Logging ──────────────────────────────────
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  // Production: stream to Winston
  app.use(morgan('combined', {
    stream: { write: msg => logger.info(msg.trim()) },
    skip:   (req) => req.url === '/health', // Skip health check logs
  }));
}

// ── Rate Limiting ─────────────────────────────────────────
app.use('/api', apiLimiter);
app.use('/api', speedLimiter);

// ── Health Check ──────────────────────────────────────────
app.get('/health', (req, res) => {
  const payload = { status: 'ok', service: 'rebrew-api', time: new Date().toISOString() };
  // Only expose env in development — never leak this in production
  if (process.env.NODE_ENV !== 'production') payload.env = process.env.NODE_ENV;
  res.status(200).json(payload);
});

// ── API Version Prefix ────────────────────────────────────
const API = `/api/${process.env.API_VERSION || 'v1'}`;

// ── Mount Routes ──────────────────────────────────────────
app.use(`${API}/auth`,       require('./routes/authRoutes'));
app.use(`${API}/products`,   require('./routes/productRoutes'));
app.use(`${API}/cart`,       require('./routes/cartRoutes'));
app.use(`${API}/orders`,     require('./routes/orderRoutes'));
// /payments/webhook is now a standard JSON route handled inside paymentRoutes.
app.use(`${API}/payments`, require('./routes/paymentRoutes'));
app.use(`${API}/contact`,    require('./routes/contactRoutes'));
app.use(`${API}/newsletter`, require('./routes/newsletterRoutes'));
app.use(`${API}/vendor`,     require('./routes/vendorRoutes'));
app.use(`${API}/events`,     require('./routes/eventRoutes'));
app.use(`${API}/reviews`, require('./routes/reviewRoutes'));
app.use(`${API}/admin`,      require('./routes/adminRoutes'));

// ── 404 Handler ───────────────────────────────────────────
app.use(notFoundMiddleware);

// ── Global Error Handler ──────────────────────────────────
app.use(errorMiddleware);

module.exports = app;
