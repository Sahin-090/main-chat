const path = require('path');
const fs = require('fs');
const { classify } = require('../middlewares/upload');
const { logActivity } = require('../models/logModel');
const config = require('../config');

// Extra per-category caps, enforced on top of the global multer size limit
// (config.uploads.maxFileSizeMb). Images: 20MB. Voice/audio: 25MB is roughly
// 5 minutes of compressed webm/ogg at typical mic bitrates.
const CATEGORY_MAX_BYTES = {
  image: 20 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
};

async function uploadFile(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }

    const { dir, type } = classify(req.file.mimetype, req.file.originalname);

    const categoryMax = CATEGORY_MAX_BYTES[type];
    if (categoryMax && req.file.size > categoryMax) {
      // Delete the file multer already wrote to disk before rejecting.
      fs.unlink(req.file.path, () => {});
      return res.status(413).json({
        success: false,
        message: `${type === 'image' ? 'Images' : 'Voice/audio files'} must be under ${Math.round(categoryMax / (1024 * 1024))}MB.`,
      });
    }

    // Absolute URL, built from the actual incoming request (req.protocol
    // already respects X-Forwarded-Proto via 'trust proxy'), so uploaded
    // files display correctly even when the frontend is hosted on a
    // different domain than this backend (e.g. frontend on Vercel, backend
    // on Railway). Using the request itself - instead of the APP_URL env
    // var - means nothing changes for existing same-origin deployments,
    // whatever domain they actually run on.
    const origin = `${req.protocol}://${req.get('host')}`;
    const relativePath = `${origin}/uploads/${dir}/${req.file.filename}`;

    await logActivity(req.user.id, 'file_upload', {
      fileName: req.file.originalname,
      size: req.file.size,
      type,
    }, req.ip);

    res.status(201).json({
      success: true,
      file: {
        url: relativePath,
        name: req.file.originalname,
        size: req.file.size,
        type,
        mimetype: req.file.mimetype,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { uploadFile };
