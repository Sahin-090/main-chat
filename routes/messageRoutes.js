const express = require('express');
const messageController = require('../controllers/messageController');
const { authenticate } = require('../middlewares/auth');

const router = express.Router();

router.use(authenticate);

// chatType is 'private' or 'group', chatId is conversation id or group id
router.get('/:chatType/:chatId/history', messageController.history);
router.get('/:chatType/:chatId/search', messageController.search);
router.get('/info/:messageId', messageController.messageInfo);

module.exports = router;
