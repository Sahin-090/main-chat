const { query } = require('../db');
const { newId } = require('../utils/helpers');

async function logActivity(userId, action, details = null, ipAddress = null) {
  await query(
    `INSERT INTO activity_logs (id, user_id, action, details, ip_address) VALUES (?, ?, ?, ?, ?)`,
    [newId(), userId, action, details ? JSON.stringify(details) : null, ipAddress]
  );
}

async function listActivityLogs(limit = 100, offset = 0, actionFilter = null) {
  if (actionFilter) {
    return query(
      `SELECT al.*, u.username FROM activity_logs al LEFT JOIN users u ON u.id = al.user_id
       WHERE al.action = ? ORDER BY al.created_at DESC LIMIT ? OFFSET ?`,
      [actionFilter, limit, offset]
    );
  }
  return query(
    `SELECT al.*, u.username FROM activity_logs al LEFT JOIN users u ON u.id = al.user_id
     ORDER BY al.created_at DESC LIMIT ? OFFSET ?`,
    [limit, offset]
  );
}

async function incrementUnread(userId, chatType, chatId) {
  await query(
    `INSERT INTO unread_counters (id, user_id, chat_type, chat_id, count)
     VALUES (?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE count = count + 1`,
    [newId(), userId, chatType, chatId]
  );
}

async function resetUnread(userId, chatType, chatId) {
  await query(
    `UPDATE unread_counters SET count = 0 WHERE user_id = ? AND chat_type = ? AND chat_id = ?`,
    [userId, chatType, chatId]
  );
}

async function getUnreadCounts(userId) {
  return query(
    `SELECT chat_type, chat_id, count FROM unread_counters WHERE user_id = ? AND count > 0`,
    [userId]
  );
}

module.exports = { logActivity, listActivityLogs, incrementUnread, resetUnread, getUnreadCounts };
