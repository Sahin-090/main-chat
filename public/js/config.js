/**
 * config.js - frontend runtime config.
 *
 * BACKEND_URL points to the Railway backend, because the frontend is
 * deployed separately on Vercel (https://sm-live-chat.vercel.app).
 * Do not add a trailing slash.
 */
const BACKEND_URL = 'https://main-chat-production.up.railway.app';

window.BACKEND_URL = BACKEND_URL;
