# 📦 Installation Guide

## 1. Prerequisites

- **Node.js 18+** (LTS recommended) — check with `node -v`
- **MySQL 5.7+ or MariaDB** (local install, XAMPP/WAMP, or a managed host)
- **npm** (comes with Node.js)
- Optional: phpMyAdmin, if you want to inspect/manage the database visually

---

## 2. Get the code

```bash
git clone <your-repo-url> secure-chat-server
cd secure-chat-server
```
(Or download/extract the provided ZIP.)

---

## 3. Install dependencies

```bash
npm install
```

---

## 4. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and set at minimum:

```ini
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=secure_chat_server

JWT_SECRET=<generate a long random string>
JWT_REFRESH_SECRET=<a different long random string>
COOKIE_SECRET=<another long random string>

ADMIN_USERNAME=admin
ADMIN_PASSWORD=<a strong password>
```

Generate strong secrets quickly:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```
Run it three times for `JWT_SECRET`, `JWT_REFRESH_SECRET`, and `COOKIE_SECRET`.

---

## 5. Set up the database

You have two options — **pick one**, not both:

### Option A — Let the server do it automatically (recommended)
Just make sure `DB_USER` has permission to `CREATE DATABASE`, then skip straight to step 6. On first boot, `db.js` will:
1. Create the `secure_chat_server` database if it doesn't exist
2. Run the full schema from `database.sql`
3. Create the bootstrap admin account from your `.env`

### Option B — Import manually via phpMyAdmin
1. Open phpMyAdmin
2. Click **Import**
3. Choose the `database.sql` file from the project root
4. Click **Go**

This is useful on shared hosts where your MySQL user can't `CREATE DATABASE` itself — pre-create the database in your host's control panel first, update `DB_NAME` in `.env` to match, then import `database.sql` into it.

---

## 6. Start the server

```bash
npm start
```

You should see:
```
[INFO] ... - Database connected and schema verified.
[INFO] ... - Bootstrap admin account created: admin
[INFO] ... - Secure Chat Server running on port 5000 [development]
```

Open **http://localhost:5000** in your browser. Register a normal user account, or log in as the admin account you configured in `.env` and visit **http://localhost:5000/admin**.

For development with auto-restart on file changes:
```bash
npm run dev
```

---

## 7. Folder permissions (Linux/macOS)

The `uploads/` subfolders need to be writable by the Node process:
```bash
chmod -R 755 uploads
```

---

## 8. Verify everything works

- [ ] Register two different accounts (use two browsers or an incognito window)
- [ ] Start a private chat between them, confirm messages arrive instantly
- [ ] Create a group with one account, join it with the other using name + password
- [ ] Upload an image and a PDF, confirm previews/downloads work
- [ ] Confirm typing indicator, online status, and seen ticks update live
- [ ] Log in as admin at `/admin` and confirm stats/users/groups/logs load

You're ready to deploy — see [RENDER_DEPLOY.md](RENDER_DEPLOY.md) and [GITHUB_DEPLOY.md](GITHUB_DEPLOY.md).
