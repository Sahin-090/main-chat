# 🔐 Secure Chat Server

A production-ready, real-time private + group chat server built with **Node.js, Express, Socket.IO, and MySQL**. Includes JWT auth, bcrypt password hashing, file sharing, typing indicators, read receipts, an admin dashboard, and a mobile-first glassmorphism UI with dark/light mode.

---

## ✨ Features

**Chat**
- Private 1:1 chat — create username/password, find users, chat in real time
- Group chat — create a group with a password, join with name + password, unlimited members
- Real-time messaging via Socket.IO
- Typing indicators, online status, last seen
- Delivered ✓ and Seen ✓✓ ticks
- Reply to message, edit message, delete for everyone
- Emoji picker, message search, date separators, auto-scroll, unread counters
- Browser notifications + in-app toasts
- **Web Push (native/background) notifications** — works even when the tab is closed or the PWA is backgrounded, with per-user on/off + preview toggles and per-conversation mute

**File sharing**
- Images, videos, audio, PDF, ZIP, APK uploads with previews and downloads

**Admin dashboard**
- Live stats (users / groups / messages)
- User list with ban / unban
- Group list with delete
- Full activity log viewer

**Security**
- JWT auth (access + refresh tokens) in httpOnly cookies
- bcrypt password hashing
- Helmet security headers, strict CORS allow-list
- CSRF protection (double-submit cookie)
- express-rate-limit on auth, messaging, and uploads
- express-validator input validation
- XSS sanitization on all user text
- 100% prepared statements (no raw string SQL) — SQL-injection safe
- Auto database/table creation on boot

---

## 📁 Project Structure

```
secure-chat-server/
├── server.js              # App entrypoint
├── config.js               # Central env-based config
├── db.js                    # MySQL pool + auto schema creation
├── socket.js               # Socket.IO real-time engine
├── database.sql             # Full schema (for phpMyAdmin import)
├── .env.example
├── package.json
├── middlewares/             # auth, csrf, rateLimiter, upload, validate, errorHandler
├── controllers/             # authController, userController, groupController,
│                             #   messageController, uploadController, adminController
├── routes/                  # authRoutes, userRoutes, groupRoutes, messageRoutes,
│                             #   uploadRoutes, adminRoutes
├── models/                  # userModel, groupModel, messageModel, conversationModel, logModel,
│                             #   pushSubscriptionModel, muteModel
├── utils/                   # jwt.js, logger.js, helpers.js, push.js, pushDispatch.js
├── uploads/                 # images/ videos/ audio/ documents/ apk/ archives/
├── public/                  # index.html, chat.html, admin.html, css/, js/ (incl. push.js), sw.js
└── docs/                    # API.md, INSTALLATION.md, RENDER_DEPLOY.md,
                              #   GITHUB_DEPLOY.md, PHP_INTEGRATION.md
```

---

## 🚀 Quick Start

```bash
git clone <your-repo-url> secure-chat-server
cd secure-chat-server
npm install
cp .env.example .env
# edit .env with your MySQL credentials and secrets
npm start
```

The server auto-creates the database and every table on first boot (or you can import `database.sql` manually via phpMyAdmin — see [docs/INSTALLATION.md](docs/INSTALLATION.md)).

Open **http://localhost:5000**. A default admin account is created automatically using `ADMIN_USERNAME` / `ADMIN_PASSWORD` from your `.env` — **change that password after first login.**

Full guides:
- 📦 [Installation Guide](docs/INSTALLATION.md)
- 📡 [API Documentation](docs/API.md)
- ☁️ [Render Deployment Guide](docs/RENDER_DEPLOY.md)
- 🐙 [GitHub Deployment Guide](docs/GITHUB_DEPLOY.md)
- 🔗 [Connecting to your PHP site on InfinityFree](docs/PHP_INTEGRATION.md)

---

## ⚙️ Configuration

All configuration lives in `.env` (copy from `.env.example`). Key variables:

| Variable | Purpose |
|---|---|
| `PORT` | Port the server listens on |
| `CLIENT_ORIGINS` | Comma-separated list of allowed frontend origins (CORS) |
| `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | MySQL connection |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Long random strings (32+ chars) — **never reuse defaults in production** |
| `COOKIE_SECURE` | Set to `true` once served over HTTPS |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Bootstrap admin account, created on first boot |
| `MAX_FILE_SIZE_MB` | Upload size limit |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push keys - generate with `npx web-push generate-vapid-keys`. Optional: leave unset and push notifications are simply disabled (everything else still works normally) |

See `.env.example` for the complete list with sane defaults.

---

## 🔔 Web Push notifications

New messages reach a recipient even when their tab is closed, the PWA is
minimized, or the whole browser is backgrounded — a plain Socket.IO
connection alone can't do this once the OS suspends the page's JS.

**Setup**
1. Generate a keypair once: `npx web-push generate-vapid-keys`
2. Put the two keys in `.env` as `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`, and set `VAPID_SUBJECT` to `mailto:you@example.com`
3. Restart the server. Nothing else to configure — the frontend fetches the public key automatically and subscribes once the user grants permission.

**Behavior**
- Users can turn notifications fully on/off and toggle message-preview text from the bell icon in the sidebar (🔔 → Notification Settings)
- Any conversation (private or group) can be muted from its chat header — muted chats never push or toast
- A push is only sent when the recipient isn't already looking at that exact conversation (tracked via the existing `chat:join`/`chat:leave` room events plus page-visibility signals), so an open, focused chat won't also get a redundant native notification
- Rapid consecutive messages from the same chat collapse into a single updated OS notification instead of stacking
- Expired/revoked push subscriptions (410/404 from the push service) are pruned automatically
- If VAPID keys aren't set, push is silently disabled — in-app real-time messaging and foreground browser notifications work exactly as before

---

## 🧑‍💻 Tech Stack

**Backend:** Node.js LTS, Express.js, Socket.IO, JWT, bcrypt, Helmet, CORS, dotenv, Multer, UUID, express-rate-limit, Morgan, compression, web-push
**Database:** MySQL (phpMyAdmin compatible)
**Frontend:** HTML5, CSS3 (glassmorphism, dark/light mode, mobile-first), vanilla JavaScript

---

## 🩹 Troubleshooting

- **"Access denied for user"** → check `DB_USER` / `DB_PASSWORD` in `.env`.
- **Socket won't connect** → confirm `CLIENT_ORIGINS` in `.env` includes the exact origin your frontend is served from (protocol + domain + port).
- **CSRF 403 errors** → the frontend must call `GET /api/auth/csrf-token` before any POST (the bundled `public/js/api.js` already does this automatically).
- **Uploads failing on Render** → Render's filesystem is ephemeral; see [docs/RENDER_DEPLOY.md](docs/RENDER_DEPLOY.md) for persistent-storage notes.

---

## 📜 License

MIT — use it, modify it, ship it.
