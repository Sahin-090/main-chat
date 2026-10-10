/**
 * config.js - frontend runtime config.
 *
 * Leave BACKEND_URL as '' when the frontend is served by this same Node
 * server (the app's original, default setup) - every request stays
 * relative, exactly as before.
 *
 * Set it to your backend's full URL ONLY when the frontend is deployed
 * separately from the backend (e.g. frontend on Vercel, backend on
 * Railway), so the app knows where to send API/socket requests:
 *
 *   const BACKEND_URL = 'https://your-app.up.railway.app';
 */
const BACKEND_URL = '';

window.BACKEND_URL = BACKEND_URL;
