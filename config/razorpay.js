'use strict';

const Razorpay = require('razorpay');
const logger   = require('../utils/logger');

if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
  logger.error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be defined');
  process.exit(1);
}

const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

module.exports = razorpay;
