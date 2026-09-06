const messageModel = require('../models/messageModel');
const conversationModel = require('../models/conversationModel');
const groupModel = require('../models/groupModel');
const { resetUnread } = require('../models/logModel');
const { sanitize } = require('../utils/helpers');

/** Confirms the requesting user can access this chat before returning data */
async function assertAccess(req, chatType, chatId) {
  if (chatType === 'private') {
    const ok = await conversationModel.isParticipant(chatId, req.user.id);
    if (!ok) {
      const err = new Error('You do not have access to this conversation.');
      err.statusCode = 403;
      throw err;
    }
  } else {
    const membership = await groupModel.isMember(chatId, req.user.id);
    if (!membership) {
      const err = new Error('You are not a member of this group.');
      err.statusCode = 403;
      throw err;
    }
  }
}

async function history(req, res, next) {
  try {
    const { chatType, chatId } = req.params;
    await assertAccess(req, chatType, chatId);

    const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
    const before = req.query.before || null;

    const messages = await messageModel.listMessages(chatType, chatId, req.user.id, { limit, before });
    await resetUnread(req.user.id, chatType, chatId);

    res.json({ success: true, messages });
  } catch (err) {
    next(err);
  }
}

async function messageInfo(req, res, next) {
  try {
    const { messageId } = req.params;
    const message = await messageModel.getMessageById(messageId);
    if (!message) {
      const err = new Error('Message not found.');
      err.statusCode = 404;
      throw err;
    }
    await assertAccess(req, message.chat_type, message.chat_id);

    const receipts = await messageModel.getMessageReceipts(messageId);
    res.json({
      success: true,
      info: {
        sentAt: message.created_at,
        isEdited: !!message.is_edited,
        isDeleted: !!message.is_deleted,
        deletedAt: message.deleted_at,
        delivered: receipts.filter((r) => r.delivered_at).map((r) => ({ userId: r.user_id, name: r.display_name, at: r.delivered_at })),
        seen: receipts.filter((r) => r.seen_at).map((r) => ({ userId: r.user_id, name: r.display_name, at: r.seen_at })),
      },
    });
  } catch (err) {
    next(err);
  }
}

async function search(req, res, next) {
  try {
    const { chatType, chatId } = req.params;
    await assertAccess(req, chatType, chatId);

    const term = sanitize((req.query.q || '').trim());
    if (term.length < 1) return res.json({ success: true, messages: [] });

    const messages = await messageModel.searchMessages(chatType, chatId, term);
    res.json({ success: true, messages });
  } catch (err) {
    next(err);
  }
}

module.exports = { history, search, messageInfo, assertAccess };
