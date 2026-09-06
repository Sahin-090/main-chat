# 🔗 Connecting Secure Chat Server to a PHP Site on InfinityFree

InfinityFree is a **static/PHP shared host** — it cannot run a persistent Node.js process, WebSocket server, or long-running background service. So the chat server itself must be deployed elsewhere (Render, Railway, a VPS, etc. — see [RENDER_DEPLOY.md](RENDER_DEPLOY.md)), and your InfinityFree PHP site simply **links to or embeds** it. This is the standard, supported pattern and works great in practice.

There are two ways to integrate them:

---

## Option A — Link out to the chat app (simplest, recommended)

Just add a "Chat" link/button on your PHP site pointing at your deployed chat server:

```php
<a href="https://secure-chat-server.onrender.com" target="_blank" class="btn">
  Open Secure Chat
</a>
```

Pros: zero cross-origin complexity, fastest to set up.
Cons: opens in a new tab/window rather than feeling embedded.

---

## Option B — Embed via iframe on your PHP page

```php
<iframe
  src="https://secure-chat-server.onrender.com/chat"
  style="width:100%; height:80vh; border:0; border-radius:12px;"
  allow="clipboard-write"
></iframe>
```

**Requirements for this to work:**

1. In your chat server's `.env`, add your InfinityFree domain to `CLIENT_ORIGINS`:
   ```ini
   CLIENT_ORIGINS=https://secure-chat-server.onrender.com,https://yourdomain.infinityfreeapp.com
   ```
2. Cookies are set with `sameSite: 'strict'` by default in this project, which **blocks cross-site iframe cookies**. If you want the login session to work inside the iframe on a different domain, relax this in `controllers/authController.js` and `middlewares/csrf.js`:
   ```js
   sameSite: 'none', // instead of 'strict'
   secure: true,      // required when sameSite is 'none' — HTTPS only
   ```
   Both your chat server and your InfinityFree site must be served over **HTTPS** for `sameSite: 'none'` cookies to work at all — InfinityFree provides free HTTPS via Cloudflare/Let's Encrypt in its control panel, and Render provides HTTPS by default.
3. Some browsers (Safari, and Chrome with strict tracking protection) still restrict third-party cookies in iframes regardless of `sameSite`. If you hit this, Option A (plain link) or Option C (single sign-on redirect) is more reliable.

---

## Option C — Single Sign-On style redirect (best UX, more work)

If your PHP site already has its own user accounts and you want a "one login" feel:

1. On your PHP site, after a user logs into your PHP app, generate a **short-lived signed token** (e.g., a JWT signed with a secret shared between PHP and Node, or simply redirect with a one-time code you store server-side).
2. Redirect the user to:
   ```
   https://secure-chat-server.onrender.com/?sso=<token>
   ```
3. Add a small endpoint in this project (e.g., `POST /api/auth/sso`) that verifies the token against the shared secret, finds/creates a matching chat account, and logs them in — mirroring the logic already in `controllers/authController.js`'s `login`/`register` functions.

This requires custom backend work on both sides (a PHP token signer + a Node token verifier) but gives the smoothest experience: users never see a separate login screen for chat.

---

## Quick checklist

- [ ] Chat server deployed somewhere that runs Node.js persistently (not InfinityFree)
- [ ] `CLIENT_ORIGINS` in `.env` includes your exact InfinityFree domain (with `https://`, no trailing slash)
- [ ] Both sites served over HTTPS if you're embedding via iframe
- [ ] If embedding: `sameSite`/`secure` cookie settings adjusted as shown above
- [ ] Test login + real-time messaging directly on the chat server's own domain first, **then** test again through your PHP site's link/iframe

---

## Why not run Node.js directly on InfinityFree?

InfinityFree (and most free PHP shared hosts) only supports PHP/static content behind their web server — there's no way to run a persistent `node server.js` process, open a WebSocket listener, or keep a MySQL connection pool alive the way this app needs. This is a hosting-platform limitation, not something fixable in the app's code. A low-cost VPS, Render, Railway, or similar Node-friendly host is required for the chat server itself.
