/**
 * logger.js - Minimal structured console logger.
 * Kept dependency-free and lightweight to avoid memory growth over time.
 */
function timestamp() {
  return new Date().toISOString();
}

const logger = {
  info: (msg, meta) => console.log(`[INFO] ${timestamp()} - ${msg}`, meta || ''),
  warn: (msg, meta) => console.warn(`[WARN] ${timestamp()} - ${msg}`, meta || ''),
  error: (msg, meta) => console.error(`[ERROR] ${timestamp()} - ${msg}`, meta || ''),
  debug: (msg, meta) => {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(`[DEBUG] ${timestamp()} - ${msg}`, meta || '');
    }
  },
};

module.exports = logger;
