const { query } = require('../db');
const { newId } = require('../utils/helpers');

async function setMuted(userId, chatType, chatId, muted) {
  if (muted) {
    await query(
      `INSERT IGNORE INTO muted_chats (id, user_id, chat_type, chat_id) VALUES (?, ?, ?, ?)`,
      [newId(), userId, chatType, chatId]
    );
  } else {
    await query('DELETE FROM muted_chats WHERE user_id = ? AND chat_type = ? AND chat_id = ?', [
      userId,
      chatType,
      chatId,
    ]);
  }
}

async function isMuted(userId, chatType, chatId) {
  const rows = await query(
    'SELECT id FROM muted_chats WHERE user_id = ? AND chat_type = ? AND chat_id = ? LIMIT 1',
    [userId, chatType, chatId]
  );
  return rows.length > 0;
}

/** All muted chat keys for a user, as `${chatType}:${chatId}` strings -
 * used by the frontend to render mute state across the whole chat list
 * without one request per chat. */
async function listMutedKeysForUser(userId) {
  const rows = await query('SELECT chat_type, chat_id FROM muted_chats WHERE user_id = ?', [userId]);
  return rows.map((r) => `${r.chat_type}:${r.chat_id}`);
}

module.exports = { setMuted, isMuted, listMutedKeysForUser };
