const express = require('express');
const adminController = require('../controllers/adminController');
const { authenticate, requireAdmin } = require('../middlewares/auth');

const router = express.Router();

router.use(authenticate, requireAdmin);

router.get('/stats', adminController.stats);
router.get('/users', adminController.listUsers);
router.get('/groups', adminController.listGroups);
router.get('/logs', adminController.logs);
router.get('/registered-accounts', adminController.registeredAccounts);
router.get('/groups/:groupId/messages', adminController.groupMessages);
router.post('/users/:userId/ban', adminController.banUser);
router.post('/users/:userId/unban', adminController.unbanUser);
router.delete('/groups/:groupId', adminController.deleteGroup);
router.delete('/conversations/:conversationId', adminController.deleteConversation);

module.exports = router;
