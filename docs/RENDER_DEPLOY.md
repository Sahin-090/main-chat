# ☁️ Render Deployment Guide

Render can host both the Node.js server and (optionally) a managed MySQL-compatible database. Render's own managed database is PostgreSQL, so for MySQL you have two solid options — both covered below.

---

## Option 1 — Use an external MySQL host (recommended, phpMyAdmin-friendly)

Good managed MySQL providers with phpMyAdmin-style access: **Railway**, **Aiven**, **PlanetScale**, **Hostinger/your existing InfinityFree-style host**, or your own VPS with MySQL + phpMyAdmin installed.

1. Provision a MySQL database with your chosen provider and note the host, port, user, password, and database name.
2. Import `database.sql` via that provider's phpMyAdmin (or let the app auto-create it on first boot, if the DB user has `CREATE DATABASE` rights).
3. Continue to **"Deploy the web service on Render"** below and point `DB_HOST` etc. at this external database.

> Make sure the database allows remote connections from Render's IP ranges (most managed providers allow this by default over SSL).

---

## Option 2 — Run MySQL yourself on a Render Private Service / Docker

If you'd rather self-host MySQL, deploy a MySQL Docker image as a second Render service on Render's paid plans and connect over Render's private network. This is more advanced — Option 1 is simpler for most users.

---

## Deploy the web service on Render

1. Push your project to GitHub (see [GITHUB_DEPLOY.md](GITHUB_DEPLOY.md)).
2. Go to [dashboard.render.com](https://dashboard.render.com) → **New +** → **Web Service**.
3. Connect your GitHub repository.
4. Configure:
   - **Name:** `secure-chat-server`
   - **Region:** closest to your users
   - **Branch:** `main`
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free or Starter (Socket.IO works fine on either; Free tier sleeps when idle)

5. Under **Environment**, add every variable from your `.env.example`, filled with real production values:

   | Key | Example value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `PORT` | `10000` (Render sets `PORT` automatically — you can leave your app reading `process.env.PORT`, which it already does) |
   | `APP_URL` | `https://secure-chat-server.onrender.com` |
   | `CLIENT_ORIGINS` | `https://secure-chat-server.onrender.com,https://yourdomain.infinityfreeapp.com` |
   | `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | from your MySQL provider |
   | `JWT_SECRET` / `JWT_REFRESH_SECRET` / `COOKIE_SECRET` | long random strings, unique per environment |
   | `COOKIE_SECURE` | `true` (Render serves HTTPS by default) |
   | `ADMIN_USERNAME` / `ADMIN_PASSWORD` | your real admin credentials |

6. Click **Create Web Service**. Render will build and deploy; watch the logs for:
   ```
   Database connected and schema verified.
   Secure Chat Server running on port 10000 [production]
   ```

7. Visit the generated `https://<your-service>.onrender.com` URL.

---

## Important production notes

### Uploaded files are ephemeral on Render's free/starter disk
Render's default filesystem is **not persistent** across deploys/restarts on most plans. For a production app handling image/video/PDF uploads long-term, either:
- Attach a **Render Disk** (persistent volume) to the service and point `UPLOAD_DIR` at a path on that disk, or
- Swap the upload storage layer for an object store (S3-compatible bucket, Cloudflare R2, Backblaze B2) — the `middlewares/upload.js` module is intentionally isolated so you can swap `multer.diskStorage` for `multer-s3` or similar without touching the rest of the app.

### WebSockets
Socket.IO works out of the box on Render — no special config needed, it supports WebSocket upgrade natively on all plans.

### Custom domain + HTTPS
Render provisions free TLS automatically once you add a custom domain under **Settings → Custom Domains**. Update `APP_URL` and `CLIENT_ORIGINS` to match.

### Health checks
The app exposes `GET /api/health` — set this as Render's health check path under **Settings → Health Check Path** for reliable zero-downtime deploys.
