const userModel = require('../models/userModel');
const conversationModel = require('../models/conversationModel');
const groupModel = require('../models/groupModel');
const { getUnreadCounts, logActivity } = require('../models/logModel');
const { sanitize, isValidDisplayName } = require('../utils/helpers');

async function search(req, res, next) {
  try {
    const term = sanitize((req.query.q || '').trim());
    if (term.length < 1) return res.json({ success: true, users: [] });
    const users = await userModel.searchUsers(term, req.user.id);
    res.json({ success: true, users });
  } catch (err) {
    next(err);
  }
}

async function listConversations(req, res, next) {
  try {
    const conversations = await conversationModel.listUserConversations(req.user.id);
    const unread = await getUnreadCounts(req.user.id);
    res.json({ success: true, conversations, unread });
  } catch (err) {
    next(err);
  }
}

async function startConversation(req, res, next) {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(422).json({ success: false, message: 'userId is required.' });

    const target = await userModel.findUserById(userId);
    if (!target) return res.status(404).json({ success: false, message: 'User not found.' });

    const conversation = await conversationModel.findOrCreateConversation(req.user.id, userId);
    res.json({
      success: true,
      conversation: {
        id: conversation.id,
        otherUser: {
          id: target.id,
          username: target.username,
          displayName: target.display_name,
          avatarColor: target.avatar_color,
          avatarUrl: target.avatar_url,
          isOnline: !!target.is_online,
          lastSeen: target.last_seen,
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

async function updateProfile(req, res, next) {
  try {
    const updates = {};

    if (req.body.displayName !== undefined) {
      const displayName = sanitize((req.body.displayName || '').trim());
      if (!isValidDisplayName(displayName)) {
        return res.status(422).json({ success: false, message: 'Nickname must be 1-64 characters.' });
      }
      updates.displayName = displayName;
    }

    if (req.body.avatarUrl !== undefined) {
      // Allow clearing the picture with null/empty string, or setting a new
      // uploaded file's URL (must point at our own /uploads/images path).
      const avatarUrl = req.body.avatarUrl ? sanitize(String(req.body.avatarUrl).trim()) : null;
      if (avatarUrl && !/^\/uploads\/images\//.test(avatarUrl)) {
        return res.status(422).json({ success: false, message: 'Invalid avatar file.' });
      }
      updates.avatarUrl = avatarUrl;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(422).json({ success: false, message: 'Nothing to update.' });
    }

    const updated = await userModel.updateProfile(req.user.id, updates);
    await logActivity(req.user.id, 'profile_update', updates, req.ip);

    // ---- Realtime push: sidebar, chat header, and user search should
    // update instantly for everyone who can currently see this profile,
    // without them needing to refresh. ----
    try {
      const io = req.app.get('io');
      if (io) {
        const payload = {
          userId: updated.id,
          displayName: updated.display_name,
          avatarUrl: updated.avatar_url,
          avatarColor: updated.avatar_color,
        };
        io.to(`user:${updated.id}`).emit('profile:updated', payload); // this user's other tabs/devices
        const conversations = await conversationModel.listUserConversations(updated.id);
        conversations.forEach((c) => io.to(`user:${c.other_user_id}`).emit('profile:updated', payload));
        const groups = await groupModel.listUserGroups(updated.id);
        groups.forEach((g) => io.to(`group:${g.id}`).emit('profile:updated', payload));
      }
    } catch (broadcastErr) {
      // Realtime push is best-effort - never fail the profile update itself.
    }

    res.json({
      success: true,
      message: 'Profile updated.',
      user: {
        id: updated.id,
        username: updated.username,
        displayName: updated.display_name,
        role: updated.role,
        avatarColor: updated.avatar_color,
        avatarUrl: updated.avatar_url,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { search, listConversations, startConversation, updateProfile };
