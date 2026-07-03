'use strict';

/**
 * ReBrew — PM2 Ecosystem Configuration
 *
 * Deployment: single process (instances: 1)
 * Reason: in-memory rate limiters are not cluster-safe without Redis.
 *         Scale to cluster mode only after adding a Redis store.
 *
 * Usage:
 *   pm2 start ecosystem.config.js --env production
 *   pm2 save
 *   pm2 startup
 */

module.exports = {
  apps: [
    {
      // ── Identity ─────────────────────────────────────────
      name:        'rebrew-api',
      script:      'server.js',
      cwd:         '/var/www/rebrew-backend',

      // ── Process model ────────────────────────────────────
      // fork = single process. Do NOT change to cluster until Redis is added.
      instances:   1,
      exec_mode:   'fork',

      // ── Environment ──────────────────────────────────────
      // PM2 does NOT auto-load .env files.
      // Secret values are loaded by require('dotenv').config() in server.js,
      // which reads /var/www/rebrew-backend/.env at process start.
      // The env_production block here only sets the two non-secret Node vars
      // that override .env (NODE_ENV and PORT are safe to set here).
      env_production: {
        NODE_ENV: 'production',
        PORT:     5000,
      },

      // ── Restart behaviour ─────────────────────────────────
      // Restart on crash, but not in a tight loop.
      autorestart:         true,
      max_restarts:        10,
      min_uptime:          '10s',  // Must stay up 10s to count as a successful start
      restart_delay:       4000,   // Wait 4s between restarts
      exp_backoff_restart_delay: 100, // Exponential backoff after repeated crashes

      // ── Memory guard ─────────────────────────────────────
      // Restart if memory exceeds 400MB — protects against slow leaks
      max_memory_restart: '400M',

      // ── Logging ──────────────────────────────────────────
      // Winston (in utils/logger.js) handles app-level logs.
      // PM2 captures stdout/stderr separately.
      error_file:    '/var/www/rebrew-backend/logs/pm2-error.log',
      out_file:      '/var/www/rebrew-backend/logs/pm2-out.log',
      merge_logs:    true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // ── Graceful shutdown ─────────────────────────────────
      // Matches the 10s forced-shutdown timeout in server.js
      kill_timeout:  10000,
      wait_ready:    false,
      listen_timeout:15000,

      // ── Watch ─────────────────────────────────────────────
      // NEVER watch in production — filesystem events cause unnecessary restarts
      watch: false,

      // ── Source maps ───────────────────────────────────────
      source_map_support: false,
    },
  ],
};
