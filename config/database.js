'use strict';

const mongoose = require('mongoose');
const logger   = require('../utils/logger');

// ── Connection Options ─────────────────────────────────────
const MONGO_OPTIONS = {
  maxPoolSize:      10,    // Maintain up to 10 socket connections
  serverSelectionTimeoutMS: 5000,  // Timeout after 5s if no server
  socketTimeoutMS:  45000, // Close sockets after 45s of inactivity
  family:           4,     // Use IPv4, skip trying IPv6
};

// ── Retry Configuration ───────────────────────────────────
const MAX_RETRIES    = 5;
const RETRY_DELAY_MS = 5000;

let retryCount = 0;

// ── Connect ───────────────────────────────────────────────
const connectDB = async () => {
  const uri = process.env.MONGO_URI;

  if (!uri) {
    logger.error('MONGO_URI is not defined in environment variables');
    process.exit(1);
  }

  try {
    const conn = await mongoose.connect(uri, MONGO_OPTIONS);

    retryCount = 0; // Reset on success
    logger.info(`MongoDB Connected: ${conn.connection.host}`);

    // ── Connection Event Listeners ─────────────────────────
    mongoose.connection.on('error', err => {
      logger.error('MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected. Attempting reconnect...');
      if (retryCount < MAX_RETRIES) {
        retryCount++;
        setTimeout(connectDB, RETRY_DELAY_MS);
      } else {
        logger.error('Max MongoDB reconnection attempts reached. Exiting.');
        process.exit(1);
      }
    });

    mongoose.connection.on('reconnected', () => {
      logger.info('MongoDB reconnected');
      retryCount = 0;
    });

    return conn;
  } catch (err) {
    logger.error(`MongoDB connection failed (attempt ${retryCount + 1}/${MAX_RETRIES}):`, err.message);

    if (retryCount < MAX_RETRIES) {
      retryCount++;
      logger.info(`Retrying in ${RETRY_DELAY_MS / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      return connectDB();
    } else {
      logger.error('Could not connect to MongoDB. Exiting.');
      process.exit(1);
    }
  }
};

// ── Graceful Shutdown ─────────────────────────────────────
const disconnectDB = async () => {
  try {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed gracefully');
  } catch (err) {
    logger.error('Error closing MongoDB connection:', err.message);
  }
};

module.exports = { connectDB, disconnectDB };
