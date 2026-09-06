/**
 * utils/pushDispatch.js
 * Fans a single push payload out to every device/browser a user has
 * subscribed from, and prunes any subscription the push service reports
 * as gone (410/404). Always best-effort - callers should fire this and
 * forget it; a push failure must never affect message delivery itself.
 */
const pushSubscriptionModel = require('../models/pushSubscriptionModel');
const push = require('./push');
const logger = require('./logger');

async function sendPushToUser(userId, payload) {
  if (!push.isConfigured) return;

  let subscriptions;
  try {
    subscriptions = await pushSubscriptionModel.listForUser(userId);
  } catch (err) {
    logger.error('pushDispatch: failed to load subscriptions', err.message);
    return;
  }

  await Promise.all(
    subscriptions.map(async (sub) => {
      const result = await push.sendToSubscription(sub, payload);
      if (!result.ok && result.expired) {
        try {
          await pushSubscriptionModel.removeByEndpoint(sub.endpoint);
        } catch (err) {
          logger.error('pushDispatch: failed to prune expired subscription', err.message);
        }
      }
    })
  );
}

module.exports = { sendPushToUser };
