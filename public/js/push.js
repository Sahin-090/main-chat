/**
 * push.js - Web Push subscription management.
 * Purely additive: talks to /api/notifications/* and the browser's
 * PushManager only. Never touches auth/sockets/existing chat logic.
 *
 * Notification.permission has three states we care about:
 *  - 'granted': safe to (re)subscribe silently, e.g. on every app boot.
 *  - 'default': user hasn't been asked yet - only prompt from an explicit
 *    user action (the Notification Settings toggle), never on page load.
 *  - 'denied': nothing we can do in-app; show the fallback message.
 */
const Push = (() => {
  let vapidPublicKey = null;
  let serverEnabled = false;
  let checked = false;

  // PushManager wants the VAPID key as a Uint8Array, not the base64url
  // string the server hands back.
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  function supported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  async function ensureServerConfig() {
    if (checked) return serverEnabled;
    checked = true;
    try {
      const res = await Api.get('/api/notifications/vapid-public-key');
      serverEnabled = !!res.enabled;
      vapidPublicKey = res.publicKey;
    } catch (e) {
      serverEnabled = false;
    }
    return serverEnabled;
  }

  // Subscribes (or re-syncs an existing subscription) and saves it
  // server-side. Does NOT prompt for permission - call requestAndSubscribe()
  // for that. Safe to call repeatedly (idempotent on the backend).
  async function subscribe() {
    if (!supported()) return false;
    if (!(await ensureServerConfig())) return false;
    if (Notification.permission !== 'granted') return false;

    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        });
      }
      await Api.post('/api/notifications/subscribe', { subscription: sub.toJSON() });
      return true;
    } catch (err) {
      console.warn('[push] subscribe failed', err);
      return false;
    }
  }

  async function unsubscribe() {
    if (!supported()) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        try {
          await Api.post('/api/notifications/unsubscribe', { endpoint: sub.endpoint });
        } catch (e) { /* best effort */ }
        await sub.unsubscribe();
      }
    } catch (err) {
      console.warn('[push] unsubscribe failed', err);
    }
  }

  // Whether THIS browser/device currently has a live Web Push subscription.
  // Used to avoid showing a redundant local (foreground) notification for
  // an event that will also arrive as a real push through the service
  // worker - see onNotification() in chat.js.
  async function isSubscribed() {
    if (!supported()) return false;
    if (Notification.permission !== 'granted') return false;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      return !!sub;
    } catch (err) {
      return false;
    }
  }

  // Called on every app boot. Only silently (re)subscribes if permission was
  // already granted in a previous session - never prompts on its own.
  async function init() {
    if (!supported()) return;
    if (!(await ensureServerConfig())) return;
    if (Notification.permission === 'granted') {
      await subscribe();
    }
  }

  // Called from an explicit user action (Notification Settings toggle).
  // Returns 'granted' | 'denied' | 'unsupported' so the caller can show the
  // right fallback message.
  async function requestAndSubscribe() {
    if (!supported()) return 'unsupported';
    if (Notification.permission === 'denied') return 'denied';

    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }
    if (permission !== 'granted') return 'denied';

    await subscribe();
    return 'granted';
  }

  return { init, subscribe, unsubscribe, requestAndSubscribe, isSubscribed, supported };
})();

// Deep-link from a notification click: the service worker focuses an
// existing tab and posts { type: 'notification-click', url }; open the
// referenced chat instead of doing nothing / a full reload.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'notification-click' && typeof openChatFromUrl === 'function') {
      openChatFromUrl(event.data.url);
    }
  });
}

// Tell the server whether this tab is actually visible/focused right now,
// so a chat that's open-but-backgrounded still gets a real push instead of
// being (wrongly) treated as "already being looked at". See socket.js
// isChatActiveForUser / presence:visibility.
document.addEventListener('visibilitychange', () => {
  if (typeof socket !== 'undefined' && socket && socket.connected) {
    socket.emit('presence:visibility', { visible: document.visibilityState === 'visible' });
  }
});
window.addEventListener('focus', () => {
  if (typeof socket !== 'undefined' && socket && socket.connected) {
    socket.emit('presence:visibility', { visible: true });
  }
});
window.addEventListener('blur', () => {
  if (typeof socket !== 'undefined' && socket && socket.connected) {
    socket.emit('presence:visibility', { visible: false });
  }
});
