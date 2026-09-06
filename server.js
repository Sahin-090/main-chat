/**
 * server.js
 * Secure Chat Server - main entrypoint.
 * Boots Express (REST API + static frontend), Socket.IO (real-time layer),
 * and MySQL (auto-creates database/tables on first run).
 */

// Force all server-side Date handling (Node's Date object, and how the MySQL
// driver interprets naive DATETIME values coming back from the DB) to
// Asia/Kolkata, so timestamps are consistent no matter what timezone the
// host OS is actually running in. Must run before anything else touches Date.
process.env.TZ = 'Asia/Kolkata';

const http = require('http');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const compression = require('compression');

const config = require('./config');
const logger = require('./utils/logger');
const { initDb } = require('./db');
const { initSocket } = require('./socket');
const { verifyCsrf } = require('./middlewares/csrf');
const { generalLimiter } = require('./middlewares/rateLimiter');
const { notFound, errorHandler } = require('./middlewares/errorHandler');
const userModel = require('./models/userModel');

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const groupRoutes = require('./routes/groupRoutes');
const messageRoutes = require('./routes/messageRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const adminRoutes = require('./routes/adminRoutes');
const notificationRoutes = require('./routes/notificationRoutes');

async function bootstrapAdmin() {
  const existing = await userModel.findUserByUsername(config.admin.username);
  if (!existing) {
    await userModel.createUser({
      username: config.admin.username,
      password: config.admin.password,
      displayName: 'Administrator',
      role: 'admin',
    });
    logger.info(`Bootstrap admin account created: ${config.admin.username}`);
  }
}

async function start() {
  await initDb();
  logger.info('Database connected and schema verified.');

  await bootstrapAdmin();

  const app = express();
  app.set('trust proxy', config.network.trustProxy); // required behind Railway/Render/Nginx/etc.
  app.set('cookieSecure', config.cookie.secure);

  // ---------------------------------------------------------
  // HTTPS enforcement (network-layer only - no route/behaviour changes)
  // Skips the health check so container/orchestrator probes never get a
  // redirect response.
  // ---------------------------------------------------------
  app.use((req, res, next) => {
    if (
      config.network.forceHttps &&
      req.path !== '/api/health' &&
      req.path !== '/health' &&
      req.headers['x-forwarded-proto'] &&
      req.headers['x-forwarded-proto'] !== 'https'
    ) {
      return res.redirect(308, `https://${req.headers.host}${req.originalUrl}`);
    }
    next();
  });

  // ---------------------------------------------------------
  // Security middleware
  // ---------------------------------------------------------
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com"
        ],
        fontSrc: [
          "'self'",
          "https://fonts.gstatic.com"
        ],
        imgSrc: [
          "'self'",
          "data:",
          "blob:"
        ],
        mediaSrc: [
          "'self'",
          "blob:"
        ],
        connectSrc: [
          "'self'",
          ...config.clientOrigins
        ],
      },
    },
    crossOriginResourcePolicy: {
      policy: "cross-origin",
    },
  })
);
  app.use(
    cors({
      origin: config.clientOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
    })
  );

  app.use(compression({ threshold: 0 })); // compress even small payloads - helps slow mobile links
  app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(cookieParser(config.cookie.secret));
  app.use(generalLimiter);

  // CSRF protection on all state-changing API routes (double-submit cookie)
  app.use('/api', verifyCsrf);

  // ---------------------------------------------------------
  // Static frontend + uploaded files
  // ---------------------------------------------------------

  // Some mime-db versions don't map .webmanifest -> application/manifest+json,
  // which makes Chrome/Edge silently refuse to treat the app as installable
  // even though the file itself is fine. Serve it explicitly, ahead of the
  // static middleware, so the content-type is always correct.
  app.get('/manifest.webmanifest', (req, res) => {
    res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(__dirname, 'public', 'manifest.webmanifest'));
  });

  app.use(
    express.static(path.join(__dirname, 'public'), {
      setHeaders: (res, filePath) => {
        const fileName = path.basename(filePath);
        if (fileName === 'sw.js') {
          // The service worker file itself must never be cached by the
          // browser/CDN - otherwise a fresh deploy can take up to a day
          // (the old max-age) to reach installed users, since the browser
          // won't even fetch the new bytes to notice they changed.
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Service-Worker-Allowed', '/');
        } else if (/\.(css|js|png|jpg|jpeg|gif|svg|webp|woff2?|ttf|ico)$/i.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=86400'); // 1 day for static assets
        } else {
          res.setHeader('Cache-Control', 'no-cache'); // HTML always revalidated
        }
      },
    })
  );
  app.use(
    '/uploads',
    express.static(path.join(__dirname, config.uploads.dir), {
      maxAge: '7d',
      setHeaders: (res) => res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'),
    })
  );

  // ---------------------------------------------------------
  // API routes
  // ---------------------------------------------------------
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/groups', groupRoutes);
  app.use('/api/messages', messageRoutes);
  app.use('/api/uploads', uploadRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/notifications', notificationRoutes);

  app.get('/api/health', (req, res) => {
    res.json({ success: true, status: 'ok', timestamp: new Date().toISOString() });
  });
  // Plain /health alias - some platforms/load balancers probe this path by default.
  app.get('/health', (req, res) => {
    res.json({ success: true, status: 'ok', timestamp: new Date().toISOString() });
  });

  // Frontend routes (SPA-ish, serve the relevant static page)
  app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
  app.get('/chat', (req, res) => res.sendFile(path.join(__dirname, 'public', 'chat.html')));
  app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

  app.use('/api', notFound);
  app.use(errorHandler);

  const server = http.createServer(app);
  const io = initSocket(server);
  app.set('io', io); // lets REST controllers (e.g. profile updates) push realtime events

  // Keep-alive timeout must exceed the reverse proxy's own idle timeout
  // (Railway/Nginx/etc.), otherwise the proxy can send a request down a
  // socket the Node server has just closed, producing intermittent 502s.
  // headersTimeout must in turn exceed keepAliveTimeout.
  server.keepAliveTimeout = 65 * 1000;
  server.headersTimeout = 66 * 1000;

  // Bind to all interfaces (IPv4 + IPv6 where the OS supports dual-stack)
  // on the platform-assigned port - required for Railway and most PaaS hosts.
  server.listen(config.port, '0.0.0.0', () => {
    logger.info(`Secure Chat Server running on port ${config.port} [${config.env}]`);
    logger.info(`Local: http://localhost:${config.port}`);
  });

  // Graceful shutdown: stop accepting new connections, let in-flight
  // requests/sockets finish, then exit - avoids dropped messages during
  // Railway/host redeploys or restarts.
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received, shutting down gracefully...`);
    server.close(() => {
      logger.info('HTTP server closed.');
      process.exit(0);
    });
    // Force-exit if something hangs (e.g. a stuck DB connection)
    setTimeout(() => process.exit(1), 10000).unref();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Rejection', reason);
  });
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception', err);
  });
}

start().catch((err) => {
  logger.error('Failed to start server', err);
  process.exit(1);
});
