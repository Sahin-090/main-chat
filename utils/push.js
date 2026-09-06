/**
 * utils/push.js
 * Thin wrapper around the `web-push` library (Web Push protocol / VAPID).
 *
 * Design goals:
 *  - Never throw into callers: a push failure must never break message
 *    sending or any other request/socket flow. Every function here is
 *    best-effort and swallows/logs its own errors.
 *  - Zero-config safe: if VAPID keys aren't set, push is simply disabled
 *    (isConfigured() === false) and callers no-op automatically.
 *  - Auto-cleans dead subscriptions (410 Gone / 404 Not Found) so the
 *    push_subscriptions table doesn't accumulate stale endpoints.
 */
const webpush = require('web-push');
const config = require('../config');
const logger = require('./logger');

const isConfigured = Boolean(config.push.publicKey && config.push.privateKey);

if (isConfigured) {
  webpush.setVapidDetails(config.push.subject, config.push.publicKey, config.push.privateKey);
} else {
  logger.warn('VAPID keys not set - Web Push notifications are disabled (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).');
}

/**
 * Send one push message to one subscription.
 * Returns { ok: true } | { ok: false, expired: true } (caller should delete
 * the subscription) | { ok: false, expired: false } (transient failure).
 */
async function sendToSubscription(subscription, payloadObj) {
  if (!isConfigured) return { ok: false, expired: false };

  const pushSubscription = {
    endpoint: subscription.endpoint,
    keys: { p256dh: subscription.p256dh, auth: subscription.auth },
  };

  try {
    await webpush.sendNotification(pushSubscription, JSON.stringify(payloadObj), {
      TTL: 60 * 60 * 24, // 24h - drop if the device stays offline longer than this
      urgency: 'high',
    });
    return { ok: true };
  } catch (err) {
    const status = err.statusCode;
    if (status === 404 || status === 410) {
      // Subscription is gone (browser unsubscribed, uninstalled, etc.)
      return { ok: false, expired: true };
    }
    logger.error('web-push send failed', { status, message: err.message });
    return { ok: false, expired: false };
  }
}

module.exports = { isConfigured, sendToSubscription };
