const express = require('express');
const userController = require('../controllers/userController');
const { authenticate } = require('../middlewares/auth');

const router = express.Router();

router.use(authenticate);

router.get('/search', userController.search);
router.get('/conversations', userController.listConversations);
router.post('/conversations/start', userController.startConversation);
router.put('/me', userController.updateProfile);

module.exports = router;
