const { verifyAccessToken } = require('../utils/jwt');
const { query } = require('../db');

/**
 * Extracts JWT from either the httpOnly cookie or the Authorization header,
 * verifies it, and attaches req.user. Also blocks banned users immediately.
 */
async function authenticate(req, res, next) {
  try {
    let token = null;

    if (req.cookies && req.cookies.access_token) {
      token = req.cookies.access_token;
    } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
    }

    const rows = await query(
      'SELECT id, username, display_name, role, is_banned, avatar_color, avatar_url FROM users WHERE id = ? LIMIT 1',
      [decoded.id]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'User no longer exists.' });
    }

    const user = rows[0];

    if (user.is_banned) {
      return res.status(403).json({ success: false, message: 'This account has been banned.' });
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/** Requires req.user.role === 'admin' - must run AFTER authenticate */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required.' });
  }
  next();
}

/**
 * Socket.IO authentication middleware - verifies JWT from the handshake
 * (cookie or auth token) before allowing the socket connection.
 */
async function authenticateSocket(socket, next) {
  try {
    let token = null;

    const cookieHeader = socket.handshake.headers.cookie;
    if (cookieHeader) {
      const match = cookieHeader.match(/access_token=([^;]+)/);
      if (match) token = decodeURIComponent(match[1]);
    }

    if (!token && socket.handshake.auth && socket.handshake.auth.token) {
      token = socket.handshake.auth.token;
    }

    if (!token) {
      return next(new Error('Authentication required.'));
    }

    const decoded = verifyAccessToken(token);

    const rows = await query(
      'SELECT id, username, display_name, role, is_banned, avatar_color, avatar_url FROM users WHERE id = ? LIMIT 1',
      [decoded.id]
    );

    if (rows.length === 0) {
      return next(new Error('User no longer exists.'));
    }

    if (rows[0].is_banned) {
      return next(new Error('This account has been banned.'));
    }

    socket.user = rows[0];
    next();
  } catch (err) {
    next(new Error('Invalid or expired token.'));
  }
}

module.exports = { authenticate, requireAdmin, authenticateSocket };
