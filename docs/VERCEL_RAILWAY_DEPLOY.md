# ☁️ Vercel (frontend) + Railway (backend) Deployment Guide

This splits the app across two hosts:
- **Backend** (Node/Express + Socket.IO + MySQL) → **Railway**
- **Frontend** (the `public/` folder) → **Vercel**

Everything else — every route, feature, and page — is unchanged. Only the
small amount of glue needed for two different domains to talk to each other
was added:

| What | File | Why |
|---|---|---|
| `BACKEND_URL` constant | `public/js/config.js` | Frontend needs to know where the backend lives, since relative `/api/...` calls would otherwise go to Vercel, not Railway |
| `COOKIE_SAME_SITE` env var | `config.js` (default `strict`, unchanged) | Cross-domain login cookies require `SameSite=None`; same-origin setups are untouched |
| Absolute upload URLs | `controllers/uploadController.js` | So images/voice notes load correctly regardless of which domain the frontend is on |

---

## 1. Deploy the backend to Railway

1. Push this whole repo to GitHub (or `railway up` from the CLI).
2. On [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**.
3. Add a MySQL database (Railway's own plugin, or an external provider) and note its credentials.
4. Under **Variables**, set:

   | Key | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `CLIENT_ORIGINS` | `https://your-frontend.vercel.app` |
   | `COOKIE_SECURE` | `true` |
   | `COOKIE_SAME_SITE` | `none` ← **required** for the Vercel↔Railway split |
   | `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | from your MySQL provider |
   | `JWT_SECRET` / `JWT_REFRESH_SECRET` / `COOKIE_SECRET` | long random strings |
   | `ADMIN_USERNAME` / `ADMIN_PASSWORD` | your real admin credentials |

   (`PORT` is set automatically by Railway — leave it alone.)

5. Deploy, then copy the generated public URL, e.g. `https://real-chat-production.up.railway.app`.
   This backend still also serves `public/` itself at that URL — that's harmless and can be ignored/left as a fallback; Vercel will serve the real frontend.

---

## 2. Point the frontend at the backend

Edit **one line** in `public/js/config.js`:

```js
const BACKEND_URL = 'https://real-chat-production.up.railway.app'; // your Railway URL
```

That's the only source change you make per-deployment — everything else in `public/` is already wired to use it (API calls, file uploads/avatars, and the Socket.IO connection).

---

## 3. Deploy the frontend to Vercel

1. On [vercel.com](https://vercel.com) → **Add New Project** → import the same repo.
2. **Root Directory:** `public` (this is a static site — no build step, no framework).
3. **Build Command:** leave empty. **Output Directory:** `.` (or leave default, since root is `public`).
4. Deploy. Vercel gives you `https://your-frontend.vercel.app`.
5. Go back to Railway's `CLIENT_ORIGINS` variable and make sure it exactly matches this Vercel URL (redeploy the backend if you change it).

---

## Notes

- **WebSockets**: Socket.IO on Railway works out of the box; `chat.js` now loads `socket.io.js` from the Railway origin automatically, so no CDN is needed.
- **Custom domains**: once you attach a custom domain in Vercel and/or Railway, update `BACKEND_URL`, `CLIENT_ORIGINS`, and `APP_URL` to match.
- **Local development / single-host deployments (Render, your own VPS, etc.) are completely unaffected** — leave `BACKEND_URL = ''` and don't set `COOKIE_SAME_SITE`, and the app behaves exactly as it did before this change.
