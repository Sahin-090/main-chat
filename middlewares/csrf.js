/**
 * csrf.js
 * Lightweight double-submit-cookie CSRF protection (no deprecated 'csurf' dependency).
 *
 * Flow:
 *  1. GET /api/auth/csrf-token issues a random token, stored both in a
 *     readable cookie ("csrf_token") and returned in the JSON body.
 *  2. The frontend echoes that token back in the "X-CSRF-Token" header on
 *     every state-changing request (POST/PUT/PATCH/DELETE).
 *  3. This middleware verifies the header matches the cookie.
 *
 * Because the token cookie is NOT httpOnly, a malicious cross-site page
 * cannot read it (blocked by browser same-origin policy) yet cannot forge
 * the header either, which defeats classic CSRF forgery.
 */
const crypto = require('crypto');

function issueCsrfToken(req, res, next) {
  const token = crypto.randomBytes(32).toString('hex');
  res.cookie('csrf_token', token, {
    httpOnly: false,
    sameSite: 'strict',
    secure: req.app.get('cookieSecure'),
    maxAge: 1000 * 60 * 60 * 2, // 2 hours
  });
  res.json({ success: true, csrfToken: token });
}

function verifyCsrf(req, res, next) {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) return next();

  const cookieToken = req.cookies ? req.cookies.csrf_token : null;
  const headerToken = req.headers['x-csrf-token'];

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ success: false, message: 'Invalid CSRF token.' });
  }
  next();
}

module.exports = { issueCsrfToken, verifyCsrf };
