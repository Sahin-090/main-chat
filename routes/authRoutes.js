const express = require('express');
const { body } = require('express-validator');
const authController = require('../controllers/authController');
const { authenticate } = require('../middlewares/auth');
const { authLimiter } = require('../middlewares/rateLimiter');
const { issueCsrfToken } = require('../middlewares/csrf');
const validate = require('../middlewares/validate');

const router = express.Router();

router.get('/csrf-token', issueCsrfToken);

router.post(
  '/register',
  authLimiter,
  [
    body('username').trim().isLength({ min: 3, max: 20 }).withMessage('Username must be 3-20 characters.'),
    body('password').isLength({ min: 6, max: 128 }).withMessage('Password must be at least 6 characters.'),
  ],
  validate,
  authController.register
);

router.post(
  '/login',
  authLimiter,
  [
    body('username').trim().notEmpty().withMessage('Username is required.'),
    body('password').notEmpty().withMessage('Password is required.'),
  ],
  validate,
  authController.login
);

router.post('/refresh', authController.refresh);
router.post('/logout', authenticate, authController.logout);
router.get('/me', authenticate, authController.me);

module.exports = router;
