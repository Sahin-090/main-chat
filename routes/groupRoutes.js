const express = require('express');
const { body } = require('express-validator');
const groupController = require('../controllers/groupController');
const { authenticate } = require('../middlewares/auth');
const validate = require('../middlewares/validate');

const router = express.Router();

router.use(authenticate);

router.post(
  '/create',
  [
    body('name').trim().isLength({ min: 3, max: 64 }),
    body('password').isLength({ min: 6, max: 128 }),
  ],
  validate,
  groupController.createGroup
);

router.post(
  '/join',
  [body('name').trim().notEmpty(), body('password').notEmpty()],
  validate,
  groupController.joinGroup
);

router.get('/mine', groupController.myGroups);
router.get('/:groupId/members', groupController.members);
router.post('/:groupId/leave', groupController.leaveGroup);

module.exports = router;
