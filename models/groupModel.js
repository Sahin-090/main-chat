const bcrypt = require('bcrypt');
const { query } = require('../db');
const { newId, colorFromSeed } = require('../utils/helpers');
const config = require('../config');

async function createGroup({ name, description, password, createdBy }) {
  const id = newId();
  const passwordHash = await bcrypt.hash(password, config.bcrypt.saltRounds);
  const avatarColor = colorFromSeed(name);

  await query(
    `INSERT INTO groups_table (id, name, description, password_hash, avatar_color, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, name, description || null, passwordHash, avatarColor, createdBy]
  );

  await addMember(id, createdBy, 'owner');
  return findGroupById(id);
}

async function findGroupById(id) {
  const rows = await query('SELECT * FROM groups_table WHERE id = ? AND is_deleted = 0 LIMIT 1', [id]);
  return rows[0] || null;
}

async function findGroupByName(name) {
  const rows = await query('SELECT * FROM groups_table WHERE name = ? AND is_deleted = 0 LIMIT 1', [name]);
  return rows[0] || null;
}

async function verifyGroupPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

async function addMember(groupId, userId, role = 'member') {
  await query(
    `INSERT IGNORE INTO group_members (id, group_id, user_id, role) VALUES (?, ?, ?, ?)`,
    [newId(), groupId, userId, role]
  );
}

async function removeMember(groupId, userId) {
  await query('DELETE FROM group_members WHERE group_id = ? AND user_id = ?', [groupId, userId]);
}

async function isMember(groupId, userId) {
  const rows = await query('SELECT id, role FROM group_members WHERE group_id = ? AND user_id = ? LIMIT 1', [
    groupId,
    userId,
  ]);
  return rows[0] || null;
}

async function listMembers(groupId) {
  return query(
    `SELECT u.id, u.username, u.display_name, u.avatar_color, u.avatar_url, u.is_online, u.last_seen, gm.role, gm.joined_at
     FROM group_members gm
     JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id = ?
     ORDER BY FIELD(gm.role, 'owner','moderator','member'), u.username ASC`,
    [groupId]
  );
}

async function countMembers(groupId) {
  const rows = await query('SELECT COUNT(*) as total FROM group_members WHERE group_id = ?', [groupId]);
  return rows[0].total;
}

async function listUserGroups(userId) {
  return query(
    `SELECT g.id, g.name, g.description, g.avatar_color, g.created_at, gm.role
     FROM group_members gm
     JOIN groups_table g ON g.id = gm.group_id
     WHERE gm.user_id = ? AND g.is_deleted = 0
     ORDER BY g.created_at DESC`,
    [userId]
  );
}

async function listAllGroups(limit = 100, offset = 0) {
  return query(
    `SELECT g.*, (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count
     FROM groups_table g WHERE g.is_deleted = 0 ORDER BY g.created_at DESC LIMIT ? OFFSET ?`,
    [limit, offset]
  );
}

async function softDeleteGroup(groupId) {
  await query('UPDATE groups_table SET is_deleted = 1 WHERE id = ?', [groupId]);
}

async function countGroups() {
  const rows = await query('SELECT COUNT(*) as total FROM groups_table WHERE is_deleted = 0');
  return rows[0].total;
}

module.exports = {
  createGroup,
  findGroupById,
  findGroupByName,
  verifyGroupPassword,
  addMember,
  removeMember,
  isMember,
  listMembers,
  countMembers,
  listUserGroups,
  listAllGroups,
  softDeleteGroup,
  countGroups,
};
