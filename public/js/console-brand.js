/**
 * console-brand.js
 * ------------------------------------------------------------
 * Prints a professional, branded identity banner to the browser
 * DevTools console on every page load, followed by a standard
 * security notice warning users against pasting untrusted code
 * (a common, reputable defense against "self-XSS" social-
 * engineering scams).
 *
 * Purely cosmetic/informational — does not read, modify, or
 * transmit any application data, and never touches existing
 * app behavior.
 * ------------------------------------------------------------
 */
(function () {
  if (typeof window === 'undefined' || typeof console === 'undefined' || !console.log) return;

  var css = {
    badgeLeft: 'background:#6366f1;color:#ffffff;font-weight:800;padding:6px 14px;border-radius:6px 0 0 6px;font-size:14px;',
    badgeRight: 'background:#1e1b4b;color:#a5b4fc;font-weight:600;padding:6px 14px;border-radius:0 6px 6px 0;font-size:14px;',
    tagline: 'color:#818cf8;font-style:italic;font-size:12px;',
    label: 'color:#94a3b8;font-weight:600;font-size:12px;',
    value: 'color:#e2e8f0;font-size:12px;',
    valueStrong: 'color:#e2e8f0;font-weight:700;font-size:12px;',
    link: 'color:#60a5fa;text-decoration:underline;font-size:12px;',
    dim: 'color:#64748b;font-size:11px;',
    warnTitle: 'color:#ef4444;font-weight:800;font-size:22px;text-shadow:1px 1px 0 rgba(0,0,0,0.3);',
    warnBody: 'color:#f1f5f9;font-size:13px;line-height:1.5;'
  };

  var APP_NAME = 'Cute';
  var APP_TAGLINE = 'End-to-end structured, real-time & encrypted-at-rest chat';
  var APP_VERSION = '1.0.0';
  var DEVELOPER = 'Sahin';
  var LINKS = {
    website: 'https://sahin.ct.ws/ML1NO8',
    github: 'https://sahin.ct.ws/qZPO17',
    telegram: 'https://sahin.ct.ws/sYsWiz',
    instagram: 'https://sahin.ct.ws/i9hOjg'
  };

  try {
    // Everything is printed through ONE console.log call, joined by
    // newlines. DevTools attaches a "file:line" reference to each
    // console.* call individually — using a single call keeps that
    // reference to one line total instead of one per row.
    var lines = [
      '%c ' + APP_NAME + ' %cWeb Client',
      '%c' + APP_TAGLINE,
      '%c ',
      '%cVersion   %c' + APP_VERSION,
      '%cCrafted by %c' + DEVELOPER + '%c, with \u2764\uFE0F',
      '%cWebsite   %c' + LINKS.website,
      '%cGitHub    %c' + LINKS.github,
      '%cTelegram  %c' + LINKS.telegram,
      '%cInstagram %c' + LINKS.instagram,
      '%c\u00A9 ' + new Date().getFullYear() + ' ' + APP_NAME + ' \u2014 All rights reserved.',
      '%c ',
      '%cStop!',
      '%cThis is a browser feature intended for developers. If someone told you to copy and paste something here to "unlock a feature", "get free coins", or "hack an account", it is a scam \u2014 doing so could give an attacker full access to your ' + APP_NAME + ' account 😂🤦‍♀️ .'
    ].join('\n');

    var styles = [
      css.badgeLeft, css.badgeRight,
      css.tagline,
      css.dim,
      css.label, css.value,
      css.label, css.valueStrong, css.value,
      css.label, css.link,
      css.label, css.link,
      css.label, css.link,
      css.label, css.link,
      css.dim,
      css.dim,
      css.warnTitle,
      css.warnBody
    ];

    console.log.apply(console, [lines].concat(styles));
  } catch (e) {
    // Never let a cosmetic banner break the app.
  }
})();
