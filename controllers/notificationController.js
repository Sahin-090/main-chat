const config = require('../config');
const push = require('../utils/push');
const userModel = require('../models/userModel');
const pushSubscriptionModel = require('../models/pushSubscriptionModel');
const muteModel = require('../models/muteModel');
const conversationModel = require('../models/conversationModel');
const groupModel = require('../models/groupModel');

/** Public VAPID key the frontend needs to create a PushSubscription.
 * Not a secret - this is the whole point of the "public" key. Returns
 * enabled:false when the server has no VAPID keys configured, so the
 * frontend can skip subscribing entirely instead of failing loudly. */
async function vapidPublicKey(req, res) {
  res.json({ success: true, enabled: push.isConfigured, publicKey: push.isConfigured ? config.push.publicKey : null });
}

async function subscribe(req, res, next) {
  try {
    const { subscription } = req.body || {};
    if (!subscription || !subscription.endpoint || !subscription.keys || !subscription.keys.p256dh || !subscription.keys.auth) {
      return res.status(422).json({ success: false, message: 'A valid push subscription is required.' });
    }
    await pushSubscriptionModel.saveSubscription(req.user.id, subscription, req.headers['user-agent']);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

async function unsubscribe(req, res, next) {
  try {
    const { endpoint } = req.body || {};
    if (!endpoint) return res.status(422).json({ success: false, message: 'endpoint is required.' });
    await pushSubscriptionModel.removeSubscription(req.user.id, endpoint);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

async function getPreferences(req, res, next) {
  try {
    const prefs = await userModel.getNotificationPrefs(req.user.id);
    res.json({ success: true, ...prefs });
  } catch (err) {
    next(err);
  }
}

async function updatePreferences(req, res, next) {
  try {
    const { notificationsEnabled, previewEnabled } = req.body || {};
    if (notificationsEnabled === undefined && previewEnabled === undefined) {
      return res.status(422).json({ success: false, message: 'Nothing to update.' });
    }
    const prefs = await userModel.updateNotificationPrefs(req.user.id, { notificationsEnabled, previewEnabled });
    res.json({ success: true, ...prefs });
  } catch (err) {
    next(err);
  }
}

async function setMute(req, res, next) {
  try {
    const { chatType, chatId, muted } = req.body || {};
    if (!['private', 'group'].includes(chatType) || !chatId) {
      return res.status(422).json({ success: false, message: 'chatType and chatId are required.' });
    }

    // Verify the user actually belongs to this chat before letting them
    // mute/unmute it - same access-control shape as the socket layer.
    const allowed =
      chatType === 'private'
        ? await conversationModel.isParticipant(chatId, req.user.id)
        : await groupModel.isMember(chatId, req.user.id);
    if (!allowed) return res.status(403).json({ success: false, message: 'Access denied.' });

    await muteModel.setMuted(req.user.id, chatType, chatId, !!muted);
    res.json({ success: true, muted: !!muted });
  } catch (err) {
    next(err);
  }
}

async function listMuted(req, res, next) {
  try {
    const muted = await muteModel.listMutedKeysForUser(req.user.id);
    res.json({ success: true, muted });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  vapidPublicKey,
  subscribe,
  unsubscribe,
  getPreferences,
  updatePreferences,
  setMute,
  listMuted,
};
