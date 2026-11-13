/**
 * config.js
 * Central configuration loaded from environment variables.
 * All other modules should read config from here instead of process.env directly.
 */
require('dotenv').config();

function required(name, fallback) {
  const val = process.env[name];
  if (val === undefined || val === '') {
    if (fallback !== undefined) return fallback;
    return undefined;
  }
  return val;
}

const config = {
  env: required('NODE_ENV', 'development'),
  port: parseInt(required('PORT', '5000'), 10),
  appUrl: required('APP_URL', 'http://localhost:5000'),

  clientOrigins: required('CLIENT_ORIGINS', 'http://localhost:5000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  db: {
    host: required('DB_HOST', 'localhost'),
    port: parseInt(required('DB_PORT', '3306'), 10),
    user: required('DB_USER', 'root'),
    password: required('DB_PASSWORD', ''),
    database: required('DB_NAME', 'secure_chat_server'),
    connectionLimit: parseInt(required('DB_CONNECTION_LIMIT', '10'), 10),
    // SSL/TLS to the database - required by managed providers like Aiven,
    // PlanetScale, etc. DB_SSL=true turns it on explicitly; it's also
    // auto-detected for known managed hosts (see db.js).
    ssl: required('DB_SSL', 'false') === 'true',
    // Optional CA certificate, base64-encoded, so it survives being pasted
    // into a single-line environment variable field (e.g. Render's UI).
    // Get this from Aiven Console -> your service -> Overview -> CA
    // certificate -> Download, then base64-encode the file's contents.
    caCertBase64: required('DB_CA_CERT_BASE64', ''),
  },

  jwt: {
    secret: required('JWT_SECRET', 'insecure_dev_secret_change_me'),
    expiresIn: required('JWT_EXPIRES_IN', '7d'),
    refreshSecret: required('JWT_REFRESH_SECRET', 'insecure_dev_refresh_secret_change_me'),
    refreshExpiresIn: required('JWT_REFRESH_EXPIRES_IN', '30d'),
  },

  cookie: {
    secret: required('COOKIE_SECRET', 'insecure_dev_cookie_secret_change_me'),
    secure: required('COOKIE_SECURE', 'false') === 'true',
    // 'strict' (default) = unchanged same-origin behaviour, exactly as before.
    // Set COOKIE_SAME_SITE=none (and COOKIE_SECURE=true) ONLY when the
    // frontend is hosted on a different domain than this backend (e.g.
    // frontend on Vercel, backend on Railway) - browsers refuse to send
    // 'strict'/'lax' cookies cross-site, which would otherwise break login.
    sameSite: required('COOKIE_SAME_SITE', 'strict'),
  },

  bcrypt: {
    saltRounds: parseInt(required('BCRYPT_SALT_ROUNDS', '12'), 10),
  },

  admin: {
    username: required('ADMIN_USERNAME', 'admin'),
    password: required('ADMIN_PASSWORD', 'ChangeMe@12345'),
    email: required('ADMIN_EMAIL', 'admin@example.com'),
  },

  uploads: {
    maxFileSizeMb: parseInt(required('MAX_FILE_SIZE_MB', '50'), 10),
    dir: required('UPLOAD_DIR', 'uploads'),
  },

  rateLimit: {
    windowMinutes: parseInt(required('RATE_LIMIT_WINDOW_MINUTES', '15'), 10),
    maxRequests: parseInt(required('RATE_LIMIT_MAX_REQUESTS', '300'), 10),
    loginMax: parseInt(required('LOGIN_RATE_LIMIT_MAX', '10'), 10),
    messageMax: parseInt(required('MESSAGE_RATE_LIMIT_MAX', '30'), 10),
  },

  group: {
    maxMembers: parseInt(required('MAX_GROUP_MEMBERS', '100000'), 10),
  },

  // Web Push (background/native notifications). Generate a keypair with
  // `npx web-push generate-vapid-keys` and set the two values below. If
  // either key is missing, push notifications are silently disabled and
  // the app keeps working exactly as before (in-app + foreground only).
  push: {
    publicKey: required('VAPID_PUBLIC_KEY', ''),
    privateKey: required('VAPID_PRIVATE_KEY', ''),
    subject: required('VAPID_SUBJECT', 'mailto:admin@example.com'),
  },

  // AI Assistant - the frontend calls this Cloudflare Worker directly
  // (browser -> Worker -> Groq). The Worker URL is not a secret, but we
  // still keep it configurable so it can be changed without a redeploy of
  // the frontend, and so its origin can be added to CSP connect-src below.
  ai: {
    workerUrl: required('AI_WORKER_URL', 'https://chat.smai-api-core.workers.dev'),
  },

  // Network / reverse-proxy tuning (Railway, Render, Nginx, Cloudflare, etc.)
  // These do not change any application behaviour - only how the server
  // interprets client IPs/protocol and whether it redirects to HTTPS.
  network: {
    // Number of hops to trust for X-Forwarded-* headers (Railway/Render = 1).
    // Accepts a number, "true"/"false", or a comma-separated list of IPs/CIDRs.
    trustProxy: (() => {
      const val = required('TRUST_PROXY', '1');
      if (val === 'true') return true;
      if (val === 'false') return false;
      const n = Number(val);
      return Number.isNaN(n) ? val : n;
    })(),
    // Redirect HTTP -> HTTPS when the server can tell (via X-Forwarded-Proto)
    // that the original request was plain HTTP. Safe to leave on even for
    // local dev since it only triggers when that header says "http".
    forceHttps: required('FORCE_HTTPS', required('NODE_ENV', 'development') === 'production' ? 'true' : 'false') === 'true',
  },
};

module.exports = config;
