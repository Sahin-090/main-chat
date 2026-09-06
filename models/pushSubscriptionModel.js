const { query } = require('../db');
const { newId, sha256 } = require('../utils/helpers');

/** Insert or refresh a push subscription for a user. Idempotent per
 * endpoint - if the same browser subscribes again (e.g. after a token
 * refresh with the same endpoint) we just re-attach it to the current
 * user and bump last_used_at, rather than creating a duplicate row. */
async function saveSubscription(userId, { endpoint, keys }, userAgent) {
  const endpointHash = sha256(endpoint);
  await query(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, endpoint_hash, p256dh, auth, user_agent, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), p256dh = VALUES(p256dh), auth = VALUES(auth),
       user_agent = VALUES(user_agent), last_used_at = NOW()`,
    [newId(), userId, endpoint, endpointHash, keys.p256dh, keys.auth, userAgent || null]
  );
}

async function removeSubscription(userId, endpoint) {
  await query('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint_hash = ?', [userId, sha256(endpoint)]);
}

async function removeByEndpoint(endpoint) {
  await query('DELETE FROM push_subscriptions WHERE endpoint_hash = ?', [sha256(endpoint)]);
}

async function listForUser(userId) {
  return query('SELECT * FROM push_subscriptions WHERE user_id = ?', [userId]);
}

async function countForUser(userId) {
  const rows = await query('SELECT COUNT(*) as total FROM push_subscriptions WHERE user_id = ?', [userId]);
  return rows[0].total;
}

module.exports = { saveSubscription, removeSubscription, removeByEndpoint, listForUser, countForUser };
