const rateLimit = require('express-rate-limit');
const config = require('../config');

/** General API rate limiter - protects every route from abuse */
const generalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMinutes * 60 * 1000,
  max: config.rateLimit.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please slow down.' },
});

/** Strict limiter for login/register to stop brute-force + spam accounts */
const authLimiter = rateLimit({
  windowMs: config.rateLimit.windowMinutes * 60 * 1000,
  max: config.rateLimit.loginMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Try again later.' },
});

/** Limiter for message-sending REST fallback endpoints (spam protection) */
const messageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: config.rateLimit.messageMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'You are sending messages too fast.' },
});

/** Upload-specific limiter */
const uploadLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many uploads. Please wait a moment.' },
});

module.exports = { generalLimiter, authLimiter, messageLimiter, uploadLimiter };
