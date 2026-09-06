const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const xss = require('xss');

/** Generate a new UUID v4 */
function newId() {
  return uuidv4();
}

/** Deterministic SHA-256 hex digest - used as a short, indexable unique key
 * for long values (e.g. Web Push subscription endpoints) that are too long
 * to index directly in MySQL. */
function sha256(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

/** Sanitize any user-provided text against XSS before storing/broadcasting */
function sanitize(text) {
  if (text === null || text === undefined) return text;
  return xss(String(text), {
    whiteList: {}, // strip all HTML tags
    stripIgnoreTag: true,
    stripIgnoreTagBody: ['script', 'style'],
  });
}

/** Deterministic conversation id ordering so user_one_id < user_two_id always */
function orderPair(idA, idB) {
  return idA < idB ? [idA, idB] : [idB, idA];
}

/** Random pastel-ish hex color for avatars, derived from a string seed */
function colorFromSeed(seed) {
  const colors = [
    '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f59e0b',
    '#10b981', '#06b6d4', '#3b82f6', '#a855f7', '#14b8a6',
  ];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

/** Basic username validation: 3-20 chars, letters/numbers/underscore/dot */
function isValidUsername(username) {
  return /^[a-zA-Z0-9._]{3,20}$/.test(username);
}

/** Password strength: min 6 chars (kept permissive for group passwords too) */
function isValidPassword(password) {
  return typeof password === 'string' && password.length >= 6 && password.length <= 128;
}

/** Nickname / display name validation: 1-64 chars after trimming, no restriction on charset (sanitized separately) */
function isValidDisplayName(name) {
  return typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= 64;
}

function paginationParams(query) {
  const limit = Math.min(parseInt(query.limit, 10) || 30, 100);
  const before = query.before || null; // ISO date cursor
  return { limit, before };
}

module.exports = {
  newId,
  sha256,
  sanitize,
  orderPair,
  colorFromSeed,
  isValidUsername,
  isValidPassword,
  isValidDisplayName,
  paginationParams,
};
