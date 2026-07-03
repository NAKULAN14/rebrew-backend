'use strict';

const winston = require('winston');
const path    = require('path');

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

// ── Custom log format (development) ──────────────────────
const devFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  let log = `${timestamp} [${level}]: ${stack || message}`;
  if (Object.keys(meta).length) {
    log += ` ${JSON.stringify(meta)}`;
  }
  return log;
});

// ── Transports ────────────────────────────────────────────
const transports = [];

if (process.env.NODE_ENV === 'production') {
  // Production: structured JSON logs (for log aggregators like Datadog, Logtail)
  transports.push(
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'error.log'),
      level:    'error',
      format:   combine(timestamp(), errors({ stack: true }), json()),
      maxsize:  10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'combined.log'),
      format:   combine(timestamp(), errors({ stack: true }), json()),
      maxsize:  10 * 1024 * 1024,
      maxFiles: 10,
    })
  );
} else {
  // Development: colourised console
  transports.push(
    new winston.transports.Console({
      format: combine(
        colorize({ all: true }),
        timestamp({ format: 'HH:mm:ss' }),
        errors({ stack: true }),
        devFormat
      ),
    })
  );
}

// ── Create logger ─────────────────────────────────────────
const logger = winston.createLogger({
  level:       process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  defaultMeta: { service: 'rebrew-api' },
  transports,
  exitOnError: false,
});

module.exports = logger;
