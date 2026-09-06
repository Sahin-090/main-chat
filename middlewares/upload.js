const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

const CATEGORY_BY_MIME = [
  { test: (m) => m.startsWith('image/'), dir: 'images', type: 'image' },
  { test: (m) => m.startsWith('video/'), dir: 'videos', type: 'video' },
  { test: (m) => m.startsWith('audio/'), dir: 'audio', type: 'audio' },
  { test: (m) => m === 'application/pdf', dir: 'documents', type: 'pdf' },
  { test: (m) => m === 'application/zip' || m === 'application/x-zip-compressed', dir: 'archives', type: 'zip' },
  { test: (m) => m === 'application/vnd.android.package-archive', dir: 'apk', type: 'apk' },
];

function classify(mimetype, originalname) {
  const ext = path.extname(originalname).toLowerCase();
  if (ext === '.apk') return { dir: 'apk', type: 'apk' };
  const found = CATEGORY_BY_MIME.find((c) => c.test(mimetype));
  if (found) return { dir: found.dir, type: found.type };
  return { dir: 'documents', type: 'file' };
}

const ALLOWED_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg',
  '.mp4', '.mov', '.avi', '.mkv', '.webm',
  '.mp3', '.wav', '.ogg', '.m4a', '.opus',
  '.pdf', '.zip', '.rar', '.7z', '.apk',
  '.doc', '.docx', '.xls', '.xlsx', '.txt', '.csv',
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const { dir } = classify(file.mimetype, file.originalname);
    const fullDir = path.join(__dirname, '..', config.uploads.dir, dir);
    fs.mkdirSync(fullDir, { recursive: true });
    cb(null, fullDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = `${uuidv4()}${ext}`;
    cb(null, safeName);
  },
});

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return cb(new Error(`File type ${ext} is not allowed.`));
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: config.uploads.maxFileSizeMb * 1024 * 1024,
  },
});

module.exports = { upload, classify };
