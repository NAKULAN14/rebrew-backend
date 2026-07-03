'use strict';

// Load environment variables first — before any other imports
require('dotenv').config();

const http   = require('http');
const app    = require('./app');
const { connectDB, disconnectDB } = require('./config/database');
const logger = require('./utils/logger');

// ── Validate critical environment variables ───────────────
const REQUIRED_ENV = [
  'MONGO_URI',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
  'FRONTEND_URL',    // Required: Stripe success_url/cancel_url — blank = Stripe rejects session
  'SMTP_HOST',       // Required: transactional email — blank = silent send failures
  'SMTP_USER',       // Required: SMTP authentication
  'SMTP_PASS',       // Required: SMTP authentication
  'EMAIL_FROM',      // Required: all outbound email From address
  'ALLOWED_ORIGINS', // Required: CORS whitelist in production
];

const missing = REQUIRED_ENV.filter(key => !process.env[key]);
if (missing.length > 0) {
  logger.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const PORT = parseInt(process.env.PORT, 10) || 5000;
const HOST = '0.0.0.0'; // Listen on all interfaces for VPS

// ── Create HTTP server ────────────────────────────────────
const server = http.createServer(app);

// ── Server timeout configuration ─────────────────────────
server.keepAliveTimeout    = 65000; // 65s (above nginx's 60s)
server.headersTimeout      = 66000;
server.timeout             = 30000; // 30s request timeout

// ── Start server ──────────────────────────────────────────
const start = async () => {
  try {
    // Connect to MongoDB first
    await connectDB();

    server.listen(PORT, HOST, () => {
      logger.info('═══════════════════════════════════════');
      logger.info(`  REBREW API — ${process.env.NODE_ENV?.toUpperCase()}`);
      logger.info(`  Server  : http://${HOST}:${PORT}`);
      logger.info(`  API     : /api/${process.env.API_VERSION || 'v1'}`);
      logger.info(`  Health  : http://localhost:${PORT}/health`);
      logger.info('═══════════════════════════════════════');
    });
  } catch (err) {
    logger.error('Failed to start server:', err.message);
    process.exit(1);
  }
};

// ── Graceful shutdown ─────────────────────────────────────
const shutdown = async (signal) => {
  logger.info(`\n${signal} received — shutting down gracefully...`);

  server.close(async () => {
    logger.info('HTTP server closed.');

    try {
      await disconnectDB();
      logger.info('Database connection closed.');
      logger.info('Shutdown complete. Goodbye.');
      process.exit(0);
    } catch (err) {
      logger.error('Error during shutdown:', err.message);
      process.exit(1);
    }
  });

  // Force shutdown after 10s if graceful shutdown stalls
  setTimeout(() => {
    logger.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 10000);
};

// ── Process event handlers ────────────────────────────────

// Graceful shutdown on SIGTERM (systemd / Docker stop)
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Graceful shutdown on SIGINT (Ctrl+C)
process.on('SIGINT', () => shutdown('SIGINT'));

// Unhandled promise rejections — log and exit cleanly
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection:', reason);
  logger.error('Promise:', promise);
  // Give the server time to finish in-flight requests
  shutdown('UNHANDLED_REJECTION');
});

// Uncaught synchronous exceptions — always fatal
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception — process will exit:', err);
  process.exit(1);
});

// ── Boot ──────────────────────────────────────────────────
start();
