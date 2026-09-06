# 🐙 GitHub Deployment Guide

## 1. Initialize the repository

```bash
cd secure-chat-server
git init
git add .
git commit -m "Initial commit: Secure Chat Server"
```

`.gitignore` is already configured to exclude `node_modules/`, `.env`, and uploaded files — only `.gitkeep` placeholders in `uploads/*` are tracked, so your repo stays clean and secrets never leak.

**Double-check before your first push:**
```bash
git status
```
Confirm `.env` is **not** listed. If it is, add it to `.gitignore` and run `git rm --cached .env`.

---

## 2. Create the GitHub repository

1. Go to [github.com/new](https://github.com/new)
2. Name it `secure-chat-server` (or anything you like)
3. Leave it empty (no README/license — you already have one)
4. Click **Create repository**

---

## 3. Push your code

```bash
git branch -M main
git remote add origin https://github.com/<your-username>/secure-chat-server.git
git push -u origin main
```

---

## 4. Keep secrets out of the repo

Never commit `.env`. Instead:
- Locally: keep using `.env` (already gitignored)
- On Render or any host: set the same variables in the platform's **Environment Variables** dashboard (see [RENDER_DEPLOY.md](RENDER_DEPLOY.md))

If you ever accidentally commit a secret, rotate it immediately (generate a new `JWT_SECRET`, DB password, etc.) — removing it from history alone is not enough once it's been pushed.

---

## 5. Recommended repo hygiene

- Add branch protection on `main` if collaborating with others
- Use `npm run dev` locally (nodemon-style `--watch`) and `npm start` in production
- Tag releases as you stabilize features:
  ```bash
  git tag -a v1.0.0 -m "First production release"
  git push origin v1.0.0
  ```

---

## 6. Continuous deployment

Once pushed to GitHub, connect the repo to Render (or any host that supports GitHub auto-deploy) — every push to `main` will trigger a fresh deploy automatically. See [RENDER_DEPLOY.md](RENDER_DEPLOY.md) for the exact steps.
