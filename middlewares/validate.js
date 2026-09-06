const { validationResult } = require('express-validator');

/**
 * Runs after an array of express-validator checks; returns 422 with
 * a clean list of errors if any validation failed. Prevents malformed /
 * malicious input from ever reaching controllers or SQL queries.
 */
function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      success: false,
      message: 'Validation failed.',
      errors: errors.array().map((e) => ({ field: e.path, message: e.msg })),
    });
  }
  next();
}

module.exports = validate;
