const jwt = require('jsonwebtoken');
const config = require('../config');

function signAccessToken(payload) {
  return jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
}

function signRefreshToken(payload) {
  return jwt.sign(payload, config.jwt.refreshSecret, { expiresIn: config.jwt.refreshExpiresIn });
}

function verifyAccessToken(token) {
  return jwt.verify(token, config.jwt.secret);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, config.jwt.refreshSecret);
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
};
