const groupModel = require('../models/groupModel');
const { logActivity } = require('../models/logModel');
const { sanitize, isValidPassword } = require('../utils/helpers');
const config = require('../config');

async function createGroup(req, res, next) {
  try {
    const name = sanitize((req.body.name || '').trim());
    const description = sanitize((req.body.description || '').trim());
    const { password } = req.body;

    if (name.length < 3 || name.length > 64) {
      return res.status(422).json({ success: false, message: 'Group name must be 3-64 characters.' });
    }
    if (!isValidPassword(password)) {
      return res.status(422).json({ success: false, message: 'Group password must be at least 6 characters.' });
    }

    const existing = await groupModel.findGroupByName(name);
    if (existing) {
      return res.status(409).json({ success: false, message: 'A group with this name already exists.' });
    }

    const group = await groupModel.createGroup({ name, description, password, createdBy: req.user.id });
    await logActivity(req.user.id, 'group_create', { groupId: group.id, name }, req.ip);

    res.status(201).json({
      success: true,
      group: {
        id: group.id,
        name: group.name,
        description: group.description,
        avatarColor: group.avatar_color,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function joinGroup(req, res, next) {
  try {
    const name = sanitize((req.body.name || '').trim());
    const { password } = req.body;

    const group = await groupModel.findGroupByName(name);
    if (!group) return res.status(404).json({ success: false, message: 'Group not found.' });

    const alreadyMember = await groupModel.isMember(group.id, req.user.id);
    if (!alreadyMember) {
      const validPassword = await groupModel.verifyGroupPassword(password, group.password_hash);
      if (!validPassword) {
        return res.status(401).json({ success: false, message: 'Incorrect group password.' });
      }

      const memberCount = await groupModel.countMembers(group.id);
      if (memberCount >= config.group.maxMembers) {
        return res.status(403).json({ success: false, message: 'Group has reached maximum members.' });
      }

      await groupModel.addMember(group.id, req.user.id, 'member');
      await logActivity(req.user.id, 'group_join', { groupId: group.id, name }, req.ip);
    }

    res.json({
      success: true,
      group: {
        id: group.id,
        name: group.name,
        description: group.description,
        avatarColor: group.avatar_color,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function myGroups(req, res, next) {
  try {
    const groups = await groupModel.listUserGroups(req.user.id);
    res.json({ success: true, groups });
  } catch (err) {
    next(err);
  }
}

async function members(req, res, next) {
  try {
    const { groupId } = req.params;
    const membership = await groupModel.isMember(groupId, req.user.id);
    if (!membership) return res.status(403).json({ success: false, message: 'You are not a member of this group.' });

    const memberList = await groupModel.listMembers(groupId);
    res.json({ success: true, members: memberList });
  } catch (err) {
    next(err);
  }
}

async function leaveGroup(req, res, next) {
  try {
    const { groupId } = req.params;
    await groupModel.removeMember(groupId, req.user.id);
    await logActivity(req.user.id, 'group_leave', { groupId }, req.ip);
    res.json({ success: true, message: 'You have left the group.' });
  } catch (err) {
    next(err);
  }
}

module.exports = { createGroup, joinGroup, myGroups, members, leaveGroup };
