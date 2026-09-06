const crypto = require('crypto');
const userModel = require('../models/userModel');
const { logActivity } = require('../models/logModel');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const { isValidUsername, isValidPassword, sanitize } = require('../utils/helpers');
const config = require('../config');

function cookieOptions(maxAgeMs) {
  return {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: 'strict',
    maxAge: maxAgeMs,
    path: '/',
  };
}

function setAuthCookies(res, accessToken, refreshToken) {
  res.cookie('access_token', accessToken, cookieOptions(1000 * 60 * 60 * 24 * 7));
  res.cookie('refresh_token', refreshToken, cookieOptions(1000 * 60 * 60 * 24 * 30));
}

async function register(req, res, next) {
  try {
    const username = sanitize((req.body.username || '').trim());
    const displayName = sanitize((req.body.displayName || username || '').trim());
    const { password } = req.body;

    if (!isValidUsername(username)) {
      return res.status(422).json({
        success: false,
        message: 'Username must be 3-20 characters: letters, numbers, dot, underscore only.',
      });
    }
    if (!isValidPassword(password)) {
      return res.status(422).json({ success: false, message: 'Password must be at least 6 characters.' });
    }

    const existing = await userModel.findUserByUsername(username);
    if (existing) {
      return res.status(409).json({ success: false, message: 'Username already taken.' });
    }

    const user = await userModel.createUser({ username, password, displayName });

    const accessToken = signAccessToken({ id: user.id, username: user.username, role: user.role });
    const refreshToken = signRefreshToken({ id: user.id });
    setAuthCookies(res, accessToken, refreshToken);

    await logActivity(user.id, 'register', { username }, req.ip);

    res.status(201).json({
      success: true,
      message: 'Account created successfully.',
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
        avatarColor: user.avatar_color,
        avatarUrl: user.avatar_url,
      },
      accessToken,
    });
 } catch (err) {
  console.error("===== REGISTER ERROR =====");
  console.error(err);
  console.error("Message:", err.message);
  console.error("Stack:", err.stack);
  return next(err);
}
}

async function login(req, res, next) {
  try {
    const username = sanitize((req.body.username || '').trim());
    const { password } = req.body;

    if (!username || !password) {
      return res.status(422).json({ success: false, message: 'Username and password are required.' });
    }

    const user = await userModel.findUserByUsername(username);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid username or password.' });
    }

    if (user.is_banned) {
      return res.status(403).json({ success: false, message: 'This account has been banned.' });
    }

    const valid = await userModel.verifyPassword(password, user.password_hash);
    if (!valid) {
      await logActivity(user.id, 'login_failed', { username }, req.ip);
      return res.status(401).json({ success: false, message: 'Invalid username or password.' });
    }

    const accessToken = signAccessToken({ id: user.id, username: user.username, role: user.role });
    const refreshToken = signRefreshToken({ id: user.id });
    setAuthCookies(res, accessToken, refreshToken);

    await userModel.setOnlineStatus(user.id, true);
    await logActivity(user.id, 'login', { username }, req.ip);

    res.json({
      success: true,
      message: 'Login successful.',
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
        avatarColor: user.avatar_color,
        avatarUrl: user.avatar_url,
      },
      accessToken,
    });
  } catch (err) {
    next(err);
  }
}

async function refresh(req, res, next) {
  try {
    const token = req.cookies ? req.cookies.refresh_token : null;
    if (!token) {
      return res.status(401).json({ success: false, message: 'No refresh token provided.' });
    }

    let decoded;
    try {
      decoded = verifyRefreshToken(token);
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid or expired refresh token.' });
    }

    const user = await userModel.findUserById(decoded.id);
    if (!user || user.is_banned) {
      return res.status(401).json({ success: false, message: 'User no longer valid.' });
    }

    const accessToken = signAccessToken({ id: user.id, username: user.username, role: user.role });
    const newRefreshToken = signRefreshToken({ id: user.id });
    setAuthCookies(res, accessToken, newRefreshToken);

    res.json({ success: true, accessToken });
  } catch (err) {
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    if (req.user) {
      await userModel.setOnlineStatus(req.user.id, false);
      await logActivity(req.user.id, 'logout', null, req.ip);
    }
    res.clearCookie('access_token');
    res.clearCookie('refresh_token');
    res.json({ success: true, message: 'Logged out successfully.' });
  } catch (err) {
    next(err);
  }
}

async function me(req, res) {
  res.json({
    success: true,
    user: {
      id: req.user.id,
      username: req.user.username,
      displayName: req.user.display_name,
      role: req.user.role,
      avatarColor: req.user.avatar_color,
      avatarUrl: req.user.avatar_url,
    },
  });
}

module.exports = { register, login, refresh, logout, me };
