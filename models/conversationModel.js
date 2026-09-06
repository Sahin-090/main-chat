const { query } = require('../db');
const { newId, orderPair } = require('../utils/helpers');

async function findOrCreateConversation(userIdA, userIdB) {
  const [userOne, userTwo] = orderPair(userIdA, userIdB);

  let rows = await query(
    'SELECT * FROM conversations WHERE user_one_id = ? AND user_two_id = ? LIMIT 1',
    [userOne, userTwo]
  );

  if (rows.length > 0) return rows[0];

  const id = newId();
  await query('INSERT INTO conversations (id, user_one_id, user_two_id) VALUES (?, ?, ?)', [
    id,
    userOne,
    userTwo,
  ]);

  rows = await query('SELECT * FROM conversations WHERE id = ? LIMIT 1', [id]);
  return rows[0];
}

async function findConversationById(id) {
  const rows = await query('SELECT * FROM conversations WHERE id = ? LIMIT 1', [id]);
  return rows[0] || null;
}

async function listUserConversations(userId) {
  return query(
    `SELECT c.id, c.created_at,
            CASE WHEN c.user_one_id = ? THEN c.user_two_id ELSE c.user_one_id END as other_user_id,
            u.username as other_username, u.display_name as other_display_name,
            u.avatar_color as other_avatar_color, u.avatar_url as other_avatar_url, u.is_online as other_is_online, u.last_seen as other_last_seen
     FROM conversations c
     JOIN users u ON u.id = CASE WHEN c.user_one_id = ? THEN c.user_two_id ELSE c.user_one_id END
     WHERE c.user_one_id = ? OR c.user_two_id = ?
     ORDER BY c.created_at DESC`,
    [userId, userId, userId, userId]
  );
}

async function isParticipant(conversationId, userId) {
  const rows = await query(
    'SELECT id FROM conversations WHERE id = ? AND (user_one_id = ? OR user_two_id = ?) LIMIT 1',
    [conversationId, userId, userId]
  );
  return rows.length > 0;
}

module.exports = { findOrCreateConversation, findConversationById, listUserConversations, isParticipant };
