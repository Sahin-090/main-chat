const express = require('express');
const uploadController = require('../controllers/uploadController');
const { authenticate } = require('../middlewares/auth');
const { uploadLimiter } = require('../middlewares/rateLimiter');
const { upload } = require('../middlewares/upload');

const router = express.Router();

router.use(authenticate);

router.post('/', uploadLimiter, upload.single('file'), uploadController.uploadFile);

module.exports = router;
