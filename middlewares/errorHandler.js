const logger = require('../utils/logger');

/** 404 handler - must be registered after all routes */
function notFound(req, res, next) {
  res.status(404).json({ success: false, message: `Route not found: ${req.originalUrl}` });
}

/** Global error handler - must be registered last */
function errorHandler(err, req, res, next) {
  logger.error(err.message, { stack: err.stack, path: req.originalUrl });

  if (err.name === 'MulterError') {
    return res.status(400).json({ success: false, message: `Upload error: ${err.message}` });
  }

  const status = err.statusCode || 500;
  const message =
    status === 500 && process.env.NODE_ENV === 'production'
      ? 'Internal server error.'
      : err.message;

  res.status(status).json({ success: false, message });
}

module.exports = { notFound, errorHandler };
