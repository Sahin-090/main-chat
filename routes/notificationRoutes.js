const express = require('express');
const notificationController = require('../controllers/notificationController');
const { authenticate } = require('../middlewares/auth');

const router = express.Router();

// Public key lookup can happen before login is strictly needed elsewhere,
// but subscribing always needs to know *which* user it belongs to, so the
// whole router is kept behind auth for simplicity and consistency.
router.use(authenticate);

router.get('/vapid-public-key', notificationController.vapidPublicKey);
router.post('/subscribe', notificationController.subscribe);
router.post('/unsubscribe', notificationController.unsubscribe);

router.get('/preferences', notificationController.getPreferences);
router.put('/preferences', notificationController.updatePreferences);

router.post('/mute', notificationController.setMute);
router.get('/muted', notificationController.listMuted);

module.exports = router;
