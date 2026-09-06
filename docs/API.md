# 📡 API Documentation

Base URL (local): `http://localhost:5000`
All request/response bodies are JSON unless noted. All endpoints under `/api` (except `GET` requests) require a CSRF token header — see [CSRF](#csrf) below.

Authentication uses **httpOnly cookies** (`access_token`, `refresh_token`) set automatically on login/register. You can alternatively send `Authorization: Bearer <accessToken>` if you're building a non-browser client.

---

## CSRF

```
GET /api/auth/csrf-token
```
Returns `{ success: true, csrfToken: "..." }` and sets a readable `csrf_token` cookie. Every state-changing request (`POST`/`PUT`/`PATCH`/`DELETE`) must include header:
```
X-CSRF-Token: <csrfToken>
```
The bundled frontend (`public/js/api.js`) handles this automatically — you only need this if writing your own client.

---

## Auth — `/api/auth`

### Register
```
POST /api/auth/register
Body: { "username": "sahin_dev", "displayName": "Sahin", "password": "min6chars" }
```
`201` → `{ success, user, accessToken }` (also sets auth cookies)

### Login
```
POST /api/auth/login
Body: { "username": "sahin_dev", "password": "min6chars" }
```
`200` → `{ success, user, accessToken }`

### Refresh token
```
POST /api/auth/refresh
```
Uses the `refresh_token` cookie. `200` → `{ success, accessToken }`

### Logout
```
POST /api/auth/logout   (requires auth)
```
Clears cookies, marks user offline.

### Current user
```
GET /api/auth/me   (requires auth)
```
`200` → `{ success, user }`

---

## Users — `/api/users` (all require auth)

### Search users
```
GET /api/users/search?q=sahin
```
`200` → `{ success, users: [{ id, username, display_name, avatar_color, is_online, last_seen }] }`

### List my conversations
```
GET /api/users/conversations
```
`200` → `{ success, conversations: [...], unread: [{ chat_type, chat_id, count }] }`

### Start / get a private conversation
```
POST /api/users/conversations/start
Body: { "userId": "<uuid>" }
```
`200` → `{ success, conversation: { id, otherUser } }`

---

## Groups — `/api/groups` (all require auth)

### Create group
```
POST /api/groups/create
Body: { "name": "Basirhat CS Batch", "description": "optional", "password": "min6chars" }
```
`201` → `{ success, group }`

### Join group
```
POST /api/groups/join
Body: { "name": "Basirhat CS Batch", "password": "min6chars" }
```
`200` → `{ success, group }` (idempotent if already a member — password only checked on first join)

### My groups
```
GET /api/groups/mine
```

### Group members
```
GET /api/groups/:groupId/members
```

### Leave group
```
POST /api/groups/:groupId/leave
```

---

## Messages — `/api/messages` (all require auth)

`chatType` is `private` or `group`; `chatId` is the conversation id or group id.

### History (paginated, newest-first cursor)
```
GET /api/messages/:chatType/:chatId/history?limit=30&before=2026-07-01T10:00:00.000Z
```
`200` → `{ success, messages: [...] }` (chronological order, oldest→newest)

### Search within a chat
```
GET /api/messages/:chatType/:chatId/search?q=hello
```

> Sending, editing, deleting, and reacting to messages happens over **Socket.IO**, not REST — see below. REST covers history/search only, to keep everything else real-time and consistent.

---

## Uploads — `/api/uploads` (requires auth)

```
POST /api/uploads
Content-Type: multipart/form-data
Field: file
```
Accepts images, video, audio, PDF, ZIP, RAR, 7z, APK, Office docs, text/CSV. Max size from `MAX_FILE_SIZE_MB` (default 50MB).

`201` → `{ success, file: { url, name, size, type, mimetype } }`

Send the returned `url`/`name`/`size`/`type` as part of a `message:send` socket event to actually post it into a chat (see below).

---

## Admin — `/api/admin` (requires auth + admin role)

| Method | Path | Description |
|---|---|---|
| GET | `/stats` | `{ totalUsers, totalGroups, totalMessages }` |
| GET | `/users?limit=&offset=` | All users |
| GET | `/groups?limit=&offset=` | All groups |
| GET | `/logs?limit=&offset=&action=` | Activity logs |
| GET | `/groups/:groupId/messages` | Recent group messages |
| POST | `/users/:userId/ban` `{ reason }` | Ban a user |
| POST | `/users/:userId/unban` | Unban a user |
| DELETE | `/groups/:groupId` | Soft-delete group + wipe its messages |
| DELETE | `/conversations/:conversationId` | Wipe a private conversation's messages |

---

## Socket.IO Events

Connect with:
```js
const socket = io('http://localhost:5000', {
  withCredentials: true,
  auth: { token: accessToken } // optional if cookie already set
});
```

### Client → Server

| Event | Payload | Notes |
|---|---|---|
| `chat:join` | `{ chatType, chatId }` | Join a chat room (call when opening a chat) |
| `chat:leave` | `{ chatType, chatId }` | Leave a chat room |
| `message:send` | `{ chatType, chatId, content, messageType, fileUrl?, fileName?, fileSize?, replyToId? }` | Ack callback: `{ success, message }` |
| `message:edit` | `{ messageId, chatType, chatId, content }` | Only sender may edit; ack callback |
| `message:delete` | `{ messageId, chatType, chatId, forEveryone }` | Sender or admin only for `forEveryone: true` |
| `message:delivered` | `{ messageId, chatType, chatId }` | Marks delivered |
| `chat:seen` | `{ chatType, chatId }` | Marks all messages in chat as seen |
| `typing:start` / `typing:stop` | `{ chatType, chatId }` | Typing indicator |
| `group:joined` | `{ groupId }` | Join the socket room for a group you just joined |
| `group:left` | `{ groupId }` | Leave the socket room |

### Server → Client

| Event | Payload |
|---|---|
| `message:new` | Full message object |
| `message:edited` | Updated message object |
| `message:deleted` | `{ messageId, forEveryone }` |
| `message:status` | `{ messageId, status: 'delivered', userId }` |
| `chat:seen` | `{ chatType, chatId, userId, seenAt }` |
| `typing:update` | `{ chatType, chatId, userId, displayName, isTyping }` |
| `presence:update` | `{ userId, isOnline, lastSeen? }` |
| `notification:new` | `{ chatType, chatId, from, preview }` |
| `group:member-joined` / `group:member-left` | `{ groupId, userId, displayName }` |

---

## Error Format

All errors return:
```json
{ "success": false, "message": "Human readable reason", "errors": [ { "field": "...", "message": "..." } ] }
```
`errors` is only present on `422` validation failures.
