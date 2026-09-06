const bcrypt = require('bcrypt');
const { query } = require('../db');
const { newId, colorFromSeed } = require('../utils/helpers');
const config = require('../config');

async function createUser({ username, password, displayName, role = 'user' }) {
  const id = newId();
  const passwordHash = await bcrypt.hash(password, config.bcrypt.saltRounds);
  const avatarColor = colorFromSeed(username);

  await query(
    `INSERT INTO users (id, username, password_hash, display_name, avatar_color, role)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, username, passwordHash, displayName || username, avatarColor, role]
  );

  return findUserById(id);
}

async function findUserByUsername(username) {
  const rows = await query('SELECT * FROM users WHERE username = ? LIMIT 1', [username]);
  return rows[0] || null;
}

async function findUserById(id) {
  const rows = await query('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
  return rows[0] || null;
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

async function setOnlineStatus(userId, isOnline) {
  await query(
    `UPDATE users SET is_online = ?, last_seen = CASE WHEN ? = 0 THEN NOW() ELSE last_seen END WHERE id = ?`,
    [isOnline ? 1 : 0, isOnline ? 1 : 0, userId]
  );
}

// Update nickname (display_name) and/or profile picture (avatar_url).
// Pass null explicitly for avatarUrl to remove a picture; pass undefined
// (i.e. omit the key) to leave a field untouched.
async function updateProfile(userId, { displayName, avatarUrl } = {}) {
  const sets = [];
  const params = [];

  if (displayName !== undefined) {
    sets.push('display_name = ?');
    params.push(displayName);
  }
  if (avatarUrl !== undefined) {
    sets.push('avatar_url = ?');
    params.push(avatarUrl);
  }

  if (sets.length === 0) return findUserById(userId);

  params.push(userId);
  await query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
  return findUserById(userId);
}

// Read the two notification toggles - kept intentionally tiny/separate from
// updateProfile so the "smart notification" checks in socket.js can do a
// single cheap lookup without pulling back the whole user row.
async function getNotificationPrefs(userId) {
  const rows = await query(
    'SELECT notifications_enabled, notification_preview_enabled FROM users WHERE id = ? LIMIT 1',
    [userId]
  );
  if (!rows[0]) return { notificationsEnabled: true, previewEnabled: true };
  return {
    notificationsEnabled: !!rows[0].notifications_enabled,
    previewEnabled: !!rows[0].notification_preview_enabled,
  };
}

async function updateNotificationPrefs(userId, { notificationsEnabled, previewEnabled } = {}) {
  const sets = [];
  const params = [];
  if (notificationsEnabled !== undefined) {
    sets.push('notifications_enabled = ?');
    params.push(notificationsEnabled ? 1 : 0);
  }
  if (previewEnabled !== undefined) {
    sets.push('notification_preview_enabled = ?');
    params.push(previewEnabled ? 1 : 0);
  }
  if (sets.length === 0) return getNotificationPrefs(userId);
  params.push(userId);
  await query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
  return getNotificationPrefs(userId);
}

async function searchUsers(term, excludeUserId, limit = 20) {
  limit = Math.max(1, Math.min(Number(limit) || 20, 100));

  const sql = `
    SELECT
      id,
      username,
      display_name,
      avatar_color,
      avatar_url,
      is_online,
      last_seen
    FROM users
    WHERE username LIKE ?
      AND id <> ?
      AND is_banned = 0
    ORDER BY username ASC
    LIMIT ${limit}
  `;

  return query(sql, [
    `%${term}%`,
    String(excludeUserId)
  ]);
}

async function listAllUsers(limit = 100, offset = 0) {
  return query(
    `SELECT id, username, display_name, avatar_color, avatar_url, role, is_online, last_seen, is_banned, banned_reason, created_at
     FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [limit, offset]
  );
}

async function banUser(userId, reason) {
  await query('UPDATE users SET is_banned = 1, banned_reason = ? WHERE id = ?', [reason || 'Violation of terms', userId]);
}

async function unbanUser(userId) {
  await query('UPDATE users SET is_banned = 0, banned_reason = NULL WHERE id = ?', [userId]);
}

async function countUsers() {
  const rows = await query('SELECT COUNT(*) as total FROM users');
  return rows[0].total;
}

// Used only by the Super Admin "Registered Accounts" panel.
// Deliberately excludes password_hash from the SELECT — credential
// values (plaintext or hashed) are never returned to any client,
// even an admin one. See adminController.registeredAccounts.
async function listRegisteredAccounts({ search = '', sort = 'DESC', limit = 25, offset = 0 } = {}) {
  limit = Math.max(1, Math.min(Number(limit) || 25, 200));
  offset = Math.max(0, Number(offset) || 0);
  const sortDir = String(sort).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const rows = await query(
    `SELECT id, username, display_name, avatar_color, avatar_url,
            role, is_online, last_seen, created_at
     FROM users
     WHERE username LIKE ?
     ORDER BY created_at ${sortDir}
     LIMIT ? OFFSET ?`,
    [`%${search}%`, limit, offset]
  );

  const countRows = await query('SELECT COUNT(*) as total FROM users WHERE username LIKE ?', [`%${search}%`]);

  return { rows, total: countRows[0].total };
}

module.exports = {
  createUser,
  findUserByUsername,
  findUserById,
  verifyPassword,
  setOnlineStatus,
  updateProfile,
  getNotificationPrefs,
  updateNotificationPrefs,
  searchUsers,
  listAllUsers,
  banUser,
  unbanUser,
  countUsers,
  listRegisteredAccounts,
};
