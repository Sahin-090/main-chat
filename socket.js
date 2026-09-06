/**
 * socket.js
 * All real-time behaviour: private + group messaging, typing indicators,
 * online/offline presence, last seen, delivered/seen ticks, message
 * edit/delete/reply, unread counters, and simple in-memory spam protection.
 */
const { Server } = require('socket.io');
const config = require('./config');
const logger = require('./utils/logger');
const { authenticateSocket } = require('./middlewares/auth');
const { sanitize, newId } = require('./utils/helpers');

const userModel = require('./models/userModel');
const groupModel = require('./models/groupModel');
const conversationModel = require('./models/conversationModel');
const messageModel = require('./models/messageModel');
const muteModel = require('./models/muteModel');
const { logActivity, incrementUnread } = require('./models/logModel');
const { sendPushToUser } = require('./utils/pushDispatch');

// userId -> Set of socket.io socket ids (supports multiple tabs/devices)
const onlineUsers = new Map();

// socketId -> { count, windowStart } simple in-memory sliding window for spam protection
const messageRateMap = new Map();
const MSG_WINDOW_MS = 10 * 1000;
const MSG_MAX_PER_WINDOW = 20;

function isSpamming(socketId) {
  const now = Date.now();
  const entry = messageRateMap.get(socketId) || { count: 0, windowStart: now };
  if (now - entry.windowStart > MSG_WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = now;
  }
  entry.count += 1;
  messageRateMap.set(socketId, entry);
  return entry.count > MSG_MAX_PER_WINDOW;
}

function roomName(chatType, chatId) {
  return `${chatType}:${chatId}`;
}

// ============================================================
// "Is this user actively looking at this chat right now?" - used to
// decide whether a background push notification is needed on top of the
// in-app 'notification:new' event. A chat only counts as actively viewed
// when the client has explicitly joined that chat room (chat:join, sent
// when the chat screen opens) AND the page is currently visible/focused
// (presence:visibility, sent on visibilitychange/focus/blur). Either
// condition failing (chat closed, or open but backgrounded/minimized)
// means the user should still get a native push notification.
// ============================================================
function isChatActiveForUser(io, userId, chatType, chatId) {
  const socketIds = onlineUsers.get(userId);
  if (!socketIds) return false;
  const key = roomName(chatType, chatId);
  for (const id of socketIds) {
    const s = io.sockets.sockets.get(id);
    if (s && s.data && s.data.activeChatKey === key && s.data.visible !== false) {
      return true;
    }
  }
  return false;
}

// ============================================================
// Background push (Web Push) for a single message recipient.
// Deliberately NOT awaited by callers - a push failure or slow push
// service must never delay the message ack or the realtime broadcast.
// Respects: notifications on/off, muted chat, and "already looking at
// it" (see isChatActiveForUser) - see README "Smart Notification System".
// ============================================================
async function notifyRecipientPush(io, recipientId, { chatType, chatId, title, preview }) {
  try {
    const prefs = await userModel.getNotificationPrefs(recipientId);
    if (!prefs.notificationsEnabled) return;

    const muted = await muteModel.isMuted(recipientId, chatType, chatId);
    if (muted) return;

    if (isChatActiveForUser(io, recipientId, chatType, chatId)) return;

    await sendPushToUser(recipientId, {
      title,
      body: prefs.previewEnabled ? preview : 'Sent you a message',
      tag: `chat:${chatType}:${chatId}`, // collapses rapid consecutive messages from the same chat
      data: { chatType, chatId, url: `/chat?open=${chatType}:${chatId}` },
    });
  } catch (err) {
    logger.error('notifyRecipientPush error', err.message);
  }
}

function initSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: config.clientOrigins,
      credentials: true,
    },
    maxHttpBufferSize: 2 * 1024 * 1024, // sockets carry text only; files go via REST upload
    // Transport fallback: try WebSocket first, drop to long-polling if the
    // network (proxies, some mobile carriers) blocks WebSocket upgrades.
    transports: ['websocket', 'polling'],
    allowUpgrades: true,
    // Generous timeouts so a slow/lossy mobile link (2G/3G handoffs, tunnel
    // dead zones) isn't mistaken for a dead connection.
    pingInterval: 25000,
    pingTimeout: 60000,
    connectTimeout: 45000,
  });

  io.use(authenticateSocket);

  io.on('connection', async (socket) => {
    const user = socket.user;
    logger.info(`Socket connected: ${user.username} (${socket.id})`);

    // Tracks which single chat room (if any) this tab currently has open,
    // and whether the tab/page is currently visible - see isChatActiveForUser.
    socket.data.activeChatKey = null;
    socket.data.visible = true;

    // ---- Presence: mark online, join personal room ----
    if (!onlineUsers.has(user.id)) onlineUsers.set(user.id, new Set());
    onlineUsers.get(user.id).add(socket.id);

    socket.join(`user:${user.id}`);

    if (onlineUsers.get(user.id).size === 1) {
      await userModel.setOnlineStatus(user.id, true);
      const groups = await groupModel.listUserGroups(user.id);
      groups.forEach((g) => socket.to(roomName('group', g.id)).emit('presence:update', { userId: user.id, isOnline: true }));
      const conversations = await conversationModel.listUserConversations(user.id);
      conversations.forEach((c) =>
        io.to(`user:${c.other_user_id}`).emit('presence:update', { userId: user.id, isOnline: true })
      );
    }

    // Auto-join all existing group rooms for this user
    const myGroups = await groupModel.listUserGroups(user.id);
    myGroups.forEach((g) => socket.join(roomName('group', g.id)));

    // ============================================================
    // JOIN / LEAVE explicit chat rooms (called when opening a chat UI)
    // ============================================================
    socket.on('chat:join', async ({ chatType, chatId }) => {
      try {
        if (chatType === 'private') {
          const ok = await conversationModel.isParticipant(chatId, user.id);
          if (!ok) return;
        } else if (chatType === 'group') {
          const member = await groupModel.isMember(chatId, user.id);
          if (!member) return;
        } else {
          return;
        }
        socket.join(roomName(chatType, chatId));
        // The client only ever has one chat screen open at a time, so this
        // join marks it as the "actively viewed" chat for push-suppression.
        socket.data.activeChatKey = roomName(chatType, chatId);
      } catch (err) {
        logger.error('chat:join error', err.message);
      }
    });

    socket.on('chat:leave', ({ chatType, chatId }) => {
      const key = roomName(chatType, chatId);
      socket.leave(key);
      if (socket.data.activeChatKey === key) socket.data.activeChatKey = null;
    });

    // Client reports page visibility/focus changes (visibilitychange,
    // blur/focus) so we know a chat that's technically still "open" isn't
    // actually on screen right now - e.g. tab in the background, app
    // minimized. Used only to decide whether to also send a native push.
    socket.on('presence:visibility', ({ visible }) => {
      socket.data.visible = visible !== false;
    });

    // ============================================================
    // MESSAGING
    // ============================================================
    socket.on('message:send', async (payload, ack) => {
      try {
        if (isSpamming(socket.id)) {
          if (ack) ack({ success: false, message: 'You are sending messages too fast. Slow down.' });
          return;
        }

        const { chatType, chatId, content, messageType = 'text', fileUrl, fileName, fileSize, duration, replyToId } = payload || {};

        if (!chatType || !chatId) {
          if (ack) ack({ success: false, message: 'chatType and chatId are required.' });
          return;
        }

        // Access control
        if (chatType === 'private') {
          const ok = await conversationModel.isParticipant(chatId, user.id);
          if (!ok) {
            if (ack) ack({ success: false, message: 'Access denied.' });
            return;
          }
        } else if (chatType === 'group') {
          const member = await groupModel.isMember(chatId, user.id);
          if (!member) {
            if (ack) ack({ success: false, message: 'You are not a member of this group.' });
            return;
          }
        } else {
          if (ack) ack({ success: false, message: 'Invalid chat type.' });
          return;
        }

        const cleanContent = messageType === 'text' ? sanitize((content || '').trim()) : sanitize(content || '');

        if (messageType === 'text' && cleanContent.length === 0) {
          if (ack) ack({ success: false, message: 'Message cannot be empty.' });
          return;
        }
        if (messageType === 'text' && cleanContent.length > 5000) {
          if (ack) ack({ success: false, message: 'Message is too long (max 5000 characters).' });
          return;
        }

        const message = await messageModel.createMessage({
          chatType,
          chatId,
          senderId: user.id,
          content: cleanContent,
          messageType,
          fileUrl: fileUrl || null,
          fileName: fileName || null,
          fileSize: fileSize || null,
          duration: messageType === 'audio' ? (parseInt(duration, 10) || null) : null,
          replyToId: replyToId || null,
        });

        const room = roomName(chatType, chatId);
        io.to(room).emit('message:new', message);

        // Unread counters + browser-notification hint for offline/away recipients
        const preview = messageType === 'text' ? cleanContent.slice(0, 120) : `Sent a ${messageType}`;

        if (chatType === 'private') {
          const convo = await conversationModel.findConversationById(chatId);
          const otherId = convo.user_one_id === user.id ? convo.user_two_id : convo.user_one_id;
          await incrementUnread(otherId, 'private', chatId);
          io.to(`user:${otherId}`).emit('notification:new', {
            chatType: 'private',
            chatId,
            from: user.display_name,
            preview,
          });
          notifyRecipientPush(io, otherId, {
            chatType: 'private',
            chatId,
            title: user.display_name,
            preview,
          });
        } else {
          const members = await groupModel.listMembers(chatId);
          const group = await groupModel.findGroupById(chatId);
          for (const m of members) {
            if (m.id === user.id) continue;
            await incrementUnread(m.id, 'group', chatId);
            io.to(`user:${m.id}`).emit('notification:new', {
              chatType: 'group',
              chatId,
              from: user.display_name,
              preview,
            });
            notifyRecipientPush(io, m.id, {
              chatType: 'group',
              chatId,
              title: group ? group.name : 'Group',
              preview: `${user.display_name}: ${preview}`,
            });
          }
        }

        if (ack) ack({ success: true, message });
      } catch (err) {
        logger.error('message:send error', err.message);
        if (ack) ack({ success: false, message: 'Failed to send message.' });
      }
    });

    socket.on('message:edit', async ({ messageId, chatType, chatId, content }, ack) => {
      try {
        const clean = sanitize((content || '').trim());
        if (!clean) {
          if (ack) ack({ success: false, message: 'Message cannot be empty.' });
          return;
        }
        const updated = await messageModel.editMessage(messageId, user.id, clean);
        io.to(roomName(chatType, chatId)).emit('message:edited', updated);
        if (ack) ack({ success: true, message: updated });
      } catch (err) {
        logger.error('message:edit error', err.message);
        if (ack) ack({ success: false, message: 'Failed to edit message.' });
      }
    });

    socket.on('message:delete', async ({ messageId, chatType, chatId, forEveryone }, ack) => {
      try {
        if (forEveryone) {
          // Ownership is verified inside the model (WHERE sender_id = ? unless
          // admin) - never trust the client's claim that it's allowed.
          const isAdmin = user.role === 'admin';
          const updated = await messageModel.deleteMessageForEveryone(messageId, user.id, isAdmin);
          io.to(roomName(chatType, chatId)).emit('message:deleted', { messageId, forEveryone: true, message: updated });
        } else {
          // "Delete for me" is persisted per-user so it stays hidden across
          // reloads/devices, without affecting what anyone else sees.
          await messageModel.deleteMessageForMe(messageId, user.id);
          io.to(`user:${user.id}`).emit('message:deleted', { messageId, forEveryone: false });
        }
        if (ack) ack({ success: true });
      } catch (err) {
        logger.error('message:delete error', err.message);
        if (ack) ack({ success: false, message: err.statusCode === 403 ? err.message : 'Failed to delete message.' });
      }
    });

    // Undo a "delete for me" within the client's undo window.
    socket.on('message:undoDelete', async ({ messageId }, ack) => {
      try {
        await messageModel.undoDeleteForMe(messageId, user.id);
        const message = await messageModel.getMessageById(messageId);
        io.to(`user:${user.id}`).emit('message:restored', { messageId, message });
        if (ack) ack({ success: true });
      } catch (err) {
        logger.error('message:undoDelete error', err.message);
        if (ack) ack({ success: false, message: 'Failed to undo delete.' });
      }
    });

    // ============================================================
    // RECEIPTS: delivered + seen ticks
    // ============================================================
    socket.on('message:delivered', async ({ messageId, chatType, chatId }) => {
      try {
        await messageModel.markDelivered(messageId, user.id);
        io.to(roomName(chatType, chatId)).emit('message:status', { messageId, status: 'delivered', userId: user.id });
      } catch (err) {
        logger.error('message:delivered error', err.message);
      }
    });

    socket.on('chat:seen', async ({ chatType, chatId }) => {
      try {
        await messageModel.markAllSeenInChat(chatType, chatId, user.id);
        socket.to(roomName(chatType, chatId)).emit('chat:seen', { chatType, chatId, userId: user.id, seenAt: new Date().toISOString() });
      } catch (err) {
        logger.error('chat:seen error', err.message);
      }
    });

    // ============================================================
    // TYPING INDICATOR
    // ============================================================
    socket.on('typing:start', ({ chatType, chatId }) => {
      socket.to(roomName(chatType, chatId)).emit('typing:update', {
        chatType,
        chatId,
        userId: user.id,
        displayName: user.display_name,
        isTyping: true,
      });
    });

    socket.on('typing:stop', ({ chatType, chatId }) => {
      socket.to(roomName(chatType, chatId)).emit('typing:update', {
        chatType,
        chatId,
        userId: user.id,
        displayName: user.display_name,
        isTyping: false,
      });
    });

    // ============================================================
    // GROUP membership live updates
    // ============================================================
    socket.on('group:joined', async ({ groupId }) => {
      socket.join(roomName('group', groupId));
      const member = await groupModel.isMember(groupId, user.id);
      if (member) {
        io.to(roomName('group', groupId)).emit('group:member-joined', {
          groupId,
          userId: user.id,
          displayName: user.display_name,
        });
      }
    });

    socket.on('group:left', ({ groupId }) => {
      io.to(roomName('group', groupId)).emit('group:member-left', { groupId, userId: user.id, displayName: user.display_name });
      socket.leave(roomName('group', groupId));
    });

    // ============================================================
    // DISCONNECT: presence + last seen
    // ============================================================
    socket.on('disconnect', async () => {
      logger.info(`Socket disconnected: ${user.username} (${socket.id})`);
      messageRateMap.delete(socket.id);

      const sockets = onlineUsers.get(user.id);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          onlineUsers.delete(user.id);
          await userModel.setOnlineStatus(user.id, false);

          const groups = await groupModel.listUserGroups(user.id);
          groups.forEach((g) =>
            io.to(roomName('group', g.id)).emit('presence:update', { userId: user.id, isOnline: false, lastSeen: new Date().toISOString() })
          );
          const conversations = await conversationModel.listUserConversations(user.id);
          conversations.forEach((c) =>
            io.to(`user:${c.other_user_id}`).emit('presence:update', { userId: user.id, isOnline: false, lastSeen: new Date().toISOString() })
          );
        }
      }
    });
  });

  return io;
}

function isUserOnline(userId) {
  return onlineUsers.has(userId);
}

module.exports = { initSocket, isUserOnline };
