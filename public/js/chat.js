/**
 * chat.js - Secure Chat Server frontend application logic.
 * Handles auth bootstrap, socket.io real-time events, chat list rendering,
 * messaging (send/edit/delete/reply), typing indicators, presence,
 * file uploads, emoji picker, and message search.
 */

const EMOJIS = ['😀','😁','😂','🤣','😊','😍','😘','😜','🤔','😎','😢','😭','😡','👍','👎','🙏','👏','🔥','🎉','❤️','💯','😴','🥳','😇','🤗','😅','🙌','👀','💪','✅'];

let me = null;
let socket = null;
let activeChat = null; // { type: 'private'|'group', id, name, avatarColor, sub }
let typingTimeout = null;
let typingUsers = new Map(); // userId -> displayName, per active chat
let replyTarget = null;
let editTarget = null;
let conversationsCache = [];
let groupsCache = [];
let lastUnreadMap = {};
let onlineStatusCache = new Map();
let messagesRendered = new Map(); // messageId -> DOM element, for current open chat
let messagesData = new Map(); // messageId -> latest message object, for current open chat
let starredMessages = new Set(); // client-side only "star" flags for this session
let contextMenuMessageId = null;
let pendingUndo = null; // { messageId, timeoutId }
let pendingAvatarUrl; // undefined = no change staged, null = remove picture, string = newly uploaded url
let mutedChatKeys = new Set(); // `${chatType}:${chatId}` for every chat this user has muted
let pendingDeepLinkKey = null; // `${chatType}:${chatId}` from a notification click / ?open= link, opened once caches are ready

// ============================================================
// BOOTSTRAP
// ============================================================
async function bootstrap() {
  try {
    const res = await Api.get('/api/auth/me');
    me = res.user;
  } catch (err) {
    window.location.href = '/';
    return;
  }

  document.getElementById('meName').textContent = me.displayName;
  document.getElementById('meRole').textContent = me.role === 'admin' ? 'Administrator' : 'Online';
  applyAvatar(document.getElementById('meAvatar'), { url: me.avatarUrl, color: me.avatarColor, name: me.displayName });
  if (me.role === 'admin') document.getElementById('adminLink').style.display = 'flex';

  // NOTE: we deliberately do NOT call Notification.requestPermission() here.
  // Requesting it without a direct user gesture (e.g. on every page load)
  // gets silently ignored or auto-blocked by Chrome's "abusive permission
  // request" protection, which can permanently mute the real prompt for
  // this origin. Push.init() below re-subscribes silently only if
  // permission was already granted in a past session; asking for it the
  // first time only happens from the explicit Notification Settings toggle
  // (Push.requestAndSubscribe), which is a real user gesture.
  Push.init(); // silently re-subscribes to Web Push if permission was already granted in a past session
  connectSocket();
  await loadMutedChats();
  await loadConversations();
  await loadGroups();
  bindGlobalUI();

  // Deep link from a notification click (?open=chatType:chatId) or from
  // the service worker focusing this tab and posting the same key.
  const openParam = new URLSearchParams(window.location.search).get('open');
  if (openParam) openChatFromUrl(`/chat?open=${openParam}`);
}

// Opens the chat referenced by a `/chat?open=chatType:chatId` URL (from a
// push notification click or a deep-linked page load). Falls back to
// re-fetching the chat list once if the target isn't in cache yet (e.g. a
// brand-new conversation that arrived while this tab was closed).
function openChatFromUrl(url) {
  let key;
  try {
    key = new URL(url, window.location.origin).searchParams.get('open');
  } catch (e) {
    return;
  }
  if (!key) return;

  const [chatType, chatId] = key.split(':');
  if (!chatType || !chatId) return;

  const tryOpen = () => {
    if (chatType === 'private') {
      const convo = conversationsCache.find((c) => c.id === chatId);
      if (!convo) return false;
      switchSidebarTab('chats');
      openChat('private', chatId, {
        name: convo.other_display_name,
        sub: convo.other_is_online ? 'online' : (convo.other_last_seen ? 'Last seen ' + timeAgo(convo.other_last_seen) : 'offline'),
        avatarColor: convo.other_avatar_color,
        avatarUrl: convo.other_avatar_url,
        otherUserId: convo.other_user_id,
      });
      return true;
    }
    const group = groupsCache.find((g) => g.id === chatId);
    if (!group) return false;
    switchSidebarTab('groups');
    openChat('group', chatId, { name: group.name, sub: 'Group', avatarColor: group.avatar_color });
    return true;
  };

  if (tryOpen()) return;

  pendingDeepLinkKey = key;
  Promise.all([loadConversations(), loadGroups()]).then(() => {
    if (pendingDeepLinkKey === key) {
      tryOpen();
      pendingDeepLinkKey = null;
    }
  });
}

let socketWasConnected = false;

function connectSocket() {
  // Guard against duplicate connections if connectSocket is ever called twice.
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
  }

  const token = localStorage.getItem('scs_access_token');
  socket = io({
    withCredentials: true,
    auth: { token },
    transports: ['websocket', 'polling'], // fall back to polling if WS is blocked
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    randomizationFactor: 0.5, // jitter, avoids thundering-herd reconnects
    timeout: 20000, // connection attempt timeout - tolerant of slow mobile links
  });

  socket.on('connect', () => {
    console.log('[socket] connected');
    if (socketWasConnected) {
      // We were connected before and just recovered from a drop - restore
      // session state without any page reload or functional change.
      Toast.success('Back online.');
      if (activeChat) {
        socket.emit('chat:join', { chatType: activeChat.type, chatId: activeChat.id });
        socket.emit('chat:seen', { chatType: activeChat.type, chatId: activeChat.id });
      }
      loadConversations();
      loadGroups();
    }
    socketWasConnected = true;
  });

  socket.on('disconnect', (reason) => {
    console.warn('[socket] disconnected:', reason);
    if (reason === 'io server disconnect') {
      // Server explicitly kicked the socket (e.g. banned) - manual reconnect only.
      socket.connect();
    } else {
      Toast.info('Reconnecting...');
    }
  });

  socket.on('reconnect_attempt', (attempt) => {
    console.log('[socket] reconnect attempt', attempt);
  });

  socket.on('connect_error', (err) => {
    console.error('[socket] connect error', err.message);
    if (err.message.includes('Authentication') || err.message.includes('token')) {
      window.location.href = '/';
    }
  });

  socket.on('message:new', onIncomingMessage);
  socket.on('message:edited', onMessageEdited);
  socket.on('message:deleted', onMessageDeleted);
  socket.on('message:restored', onMessageRestored);
  socket.on('message:status', onMessageStatus);
  socket.on('chat:seen', onChatSeen);
  socket.on('typing:update', onTypingUpdate);
  socket.on('presence:update', onPresenceUpdate);
  socket.on('notification:new', onNotification);
  socket.on('group:member-joined', () => loadGroups());
  socket.on('group:member-left', () => loadGroups());
  socket.on('profile:updated', onProfileUpdated);
}

// Nudge the socket to reconnect immediately when the browser regains
// connectivity (e.g. Wi-Fi <-> mobile data handoff) instead of waiting for
// the next backoff tick.
window.addEventListener('online', () => {
  if (socket && !socket.connected) {
    Toast.info('Network restored, reconnecting...');
    socket.connect();
  }
});
window.addEventListener('offline', () => {
  Toast.error('No internet connection.');
});

async function logout() {
  try {
    await Api.post('/api/auth/logout');
  } catch (e) { /* ignore */ }
  localStorage.removeItem('scs_user');
  localStorage.removeItem('scs_access_token');
  window.location.href = '/';
}

// ============================================================
// MY PROFILE: nickname + profile picture
// ============================================================
function openProfileModal() {
  document.getElementById('profileDisplayName').value = me.displayName;
  document.getElementById('profileFormError').textContent = '';
  pendingAvatarUrl = undefined;
  applyAvatar(document.getElementById('profileAvatarPreview'), { url: me.avatarUrl, color: me.avatarColor, name: me.displayName });
  document.getElementById('profileAvatarRemove').classList.toggle('hidden', !me.avatarUrl);
  openModal('profileModal');
}

async function handleProfileAvatarSelected(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    Toast.error('Please choose an image file.');
    return;
  }
  const maxMb = 8;
  if (file.size > maxMb * 1024 * 1024) {
    Toast.error(`Image too large. Max ${maxMb}MB.`);
    return;
  }

  const formData = new FormData();
  formData.append('file', file);

  Toast.info('Uploading picture...');
  try {
    const res = await Api.post('/api/uploads', formData);
    pendingAvatarUrl = res.file.url;
    applyAvatar(document.getElementById('profileAvatarPreview'), { url: pendingAvatarUrl, color: me.avatarColor, name: me.displayName });
    document.getElementById('profileAvatarRemove').classList.remove('hidden');
  } catch (err) {
    Toast.error(err.data?.message || err.message || 'Upload failed.');
  }
}

function removeProfileAvatar() {
  pendingAvatarUrl = null;
  applyAvatar(document.getElementById('profileAvatarPreview'), { url: null, color: me.avatarColor, name: me.displayName });
  document.getElementById('profileAvatarRemove').classList.add('hidden');
}

async function saveProfile(e) {
  e.preventDefault();
  const errorEl = document.getElementById('profileFormError');
  errorEl.textContent = '';

  const displayName = document.getElementById('profileDisplayName').value.trim();
  const body = { displayName };
  if (pendingAvatarUrl !== undefined) body.avatarUrl = pendingAvatarUrl;

  try {
    const res = await Api.put('/api/users/me', body);
    me = { ...me, ...res.user };
    document.getElementById('meName').textContent = me.displayName;
    applyAvatar(document.getElementById('meAvatar'), { url: me.avatarUrl, color: me.avatarColor, name: me.displayName });
    closeModal('profileModal');
    Toast.success('Profile updated.');
    await loadConversations();
    await loadGroups();
  } catch (err) {
    errorEl.textContent = err.data?.message || err.message || 'Failed to update profile.';
  }
}

// ============================================================
// NOTIFICATION SETTINGS (on/off, preview) + per-chat mute
// ============================================================
async function loadMutedChats() {
  try {
    const res = await Api.get('/api/notifications/muted');
    mutedChatKeys = new Set(res.muted || []);
  } catch (e) {
    mutedChatKeys = new Set();
  }
  updateMuteButtonState();
}

function updateMuteButtonState() {
  const btn = document.getElementById('muteToggleBtn');
  if (!btn || !activeChat) return;
  const muted = mutedChatKeys.has(`${activeChat.type}:${activeChat.id}`);
  btn.textContent = muted ? '🔕' : '🔔';
  btn.classList.toggle('muted', muted);
  btn.title = muted ? 'Unmute notifications' : 'Mute notifications';
}

async function toggleMuteActiveChat() {
  if (!activeChat) return;
  const key = `${activeChat.type}:${activeChat.id}`;
  const nextMuted = !mutedChatKeys.has(key);
  try {
    await Api.post('/api/notifications/mute', { chatType: activeChat.type, chatId: activeChat.id, muted: nextMuted });
    if (nextMuted) mutedChatKeys.add(key);
    else mutedChatKeys.delete(key);
    updateMuteButtonState();
    Toast.success(nextMuted ? 'Conversation muted.' : 'Conversation unmuted.');
  } catch (err) {
    Toast.error(err.data?.message || err.message || 'Failed to update mute setting.');
  }
}

async function openNotificationSettings() {
  const errorEl = document.getElementById('notifSettingsError');
  const hintEl = document.getElementById('notifPermissionHint');
  errorEl.textContent = '';

  const enabledToggle = document.getElementById('notifEnabledToggle');
  const previewToggle = document.getElementById('notifPreviewToggle');

  const permission = 'Notification' in window ? Notification.permission : 'denied';
  hintEl.classList.toggle('hidden', permission !== 'denied');
  enabledToggle.disabled = permission === 'denied';

  try {
    const res = await Api.get('/api/notifications/preferences');
    enabledToggle.checked = permission !== 'denied' && !!res.notificationsEnabled;
    previewToggle.checked = !!res.previewEnabled;
    previewToggle.disabled = !enabledToggle.checked;
  } catch (err) {
    errorEl.textContent = err.data?.message || err.message || 'Failed to load notification settings.';
  }

  openModal('notifSettingsModal');
}

async function onNotifEnabledToggle(checked) {
  const errorEl = document.getElementById('notifSettingsError');
  const previewToggle = document.getElementById('notifPreviewToggle');
  errorEl.textContent = '';

  try {
    if (checked) {
      const result = await Push.requestAndSubscribe();
      if (result !== 'granted') {
        document.getElementById('notifEnabledToggle').checked = false;
        document.getElementById('notifPermissionHint').classList.toggle('hidden', result !== 'denied');
        errorEl.textContent = result === 'unsupported'
          ? 'Push notifications are not supported on this browser.'
          : 'Notifications are currently disabled. Please enable them from your browser settings. 💕';
        return;
      }
    } else {
      await Push.unsubscribe();
    }
    await Api.put('/api/notifications/preferences', { notificationsEnabled: checked });
    previewToggle.disabled = !checked;
    Toast.success(checked ? 'Notifications enabled.' : 'Notifications disabled.');
  } catch (err) {
    errorEl.textContent = err.data?.message || err.message || 'Failed to update notification settings.';
  }
}

async function onNotifPreviewToggle(checked) {
  const errorEl = document.getElementById('notifSettingsError');
  errorEl.textContent = '';
  try {
    await Api.put('/api/notifications/preferences', { previewEnabled: checked });
  } catch (err) {
    errorEl.textContent = err.data?.message || err.message || 'Failed to update notification settings.';
  }
}

document.addEventListener('DOMContentLoaded', bootstrap);

// ============================================================
// SIDEBAR: CHAT LIST / GROUP LIST
// ============================================================
function switchSidebarTab(tab) {
  document.querySelectorAll('.sidebar-tab').forEach((el) => el.classList.toggle('active', el.dataset.tab === tab));
  document.getElementById('chatListChats').classList.toggle('hidden', tab !== 'chats');
  document.getElementById('chatListGroups').classList.toggle('hidden', tab !== 'groups');
}

async function loadConversations() {
  const res = await Api.get('/api/users/conversations');
  conversationsCache = res.conversations;
  const unreadMap = {};
  (res.unread || []).forEach((u) => {
    unreadMap[`${u.chat_type}:${u.chat_id}`] = u.count;
  });
  lastUnreadMap = unreadMap;
  renderChatList(unreadMap);
}

function renderChatList(unreadMap = {}) {
  const container = document.getElementById('chatListChats');
  if (conversationsCache.length === 0) {
    container.innerHTML = `<div class="empty-state">No conversations yet.<br>Tap + to start a private chat.</div>`;
    return;
  }
  container.innerHTML = '';
  conversationsCache.forEach((c) => {
    const unread = unreadMap[`private:${c.id}`] || 0;
    const item = document.createElement('div');
    item.className = 'chat-item';
    item.dataset.chatId = c.id;
    item.dataset.chatType = 'private';
    item.innerHTML = `
      <div class="avatar" style="${avatarStyle(c.other_avatar_color)}">
        ${avatarGlyph(c.other_avatar_url, c.other_display_name, false)}
        ${avatarImgTag(c.other_avatar_url)}
        <span class="status-dot ${c.other_is_online ? 'online' : ''}"></span>
      </div>
      <div class="chat-item-body">
        <div class="chat-item-top">
          <span class="chat-item-name">${escapeHtml(c.other_display_name)}</span>
        </div>
        <div class="chat-item-preview">@${escapeHtml(c.other_username)} ${c.other_is_online ? '· online' : c.other_last_seen ? '· Last seen ' + timeAgo(c.other_last_seen) : ''}</div>
      </div>
      ${unread > 0 ? `<span class="unread-badge">${unread > 99 ? '99+' : unread}</span>` : ''}
    `;
    item.onclick = () => openChat('private', c.id, {
      name: c.other_display_name,
      sub: c.other_is_online ? 'online' : (c.other_last_seen ? 'Last seen ' + timeAgo(c.other_last_seen) : 'offline'),
      avatarColor: c.other_avatar_color,
      avatarUrl: c.other_avatar_url,
      otherUserId: c.other_user_id,
    });
    container.appendChild(item);
  });
}

async function loadGroups() {
  const res = await Api.get('/api/groups/mine');
  groupsCache = res.groups;
  renderGroupList();
}

function renderGroupList() {
  const container = document.getElementById('chatListGroups');
  if (groupsCache.length === 0) {
    container.innerHTML = `<div class="empty-state">No groups yet.<br>Tap + to create or join one.</div>`;
    return;
  }
  container.innerHTML = '';
  groupsCache.forEach((g) => {
    const item = document.createElement('div');
    item.className = 'chat-item';
    item.dataset.chatId = g.id;
    item.dataset.chatType = 'group';
    item.innerHTML = `
      <div class="avatar" style="background:${g.avatar_color}">👥</div>
      <div class="chat-item-body">
        <div class="chat-item-top"><span class="chat-item-name">${escapeHtml(g.name)}</span></div>
        <div class="chat-item-preview">${escapeHtml(g.description || 'Group chat')}</div>
      </div>
    `;
    item.onclick = () => openChat('group', g.id, { name: g.name, sub: 'Group', avatarColor: g.avatar_color });
    container.appendChild(item);
  });
}

function markActiveInList(chatId) {
  document.querySelectorAll('.chat-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.chatId === chatId);
  });
}

// ============================================================
// OPEN A CHAT
// ============================================================
let chatHistoryPushed = false; // tracks whether we've pushed a history entry for the open chat view

async function openChat(chatType, chatId, meta) {
  if (activeChat) {
    socket.emit('chat:leave', { chatType: activeChat.type, chatId: activeChat.id });
  }
  activeChat = { type: chatType, id: chatId, ...meta };
  markActiveInList(chatId);
  updateMuteButtonState();

  // Push a history entry the first time we enter chat view, so the browser/
  // hardware back button (and mobile swipe-back gesture) closes the chat
  // instead of leaving the app.
  if (!chatHistoryPushed) {
    history.pushState({ scsChatOpen: true }, '');
    chatHistoryPushed = true;
  }

  document.getElementById('chatApp').classList.remove('view-list');
  document.getElementById('chatApp').classList.add('view-chat');
  document.getElementById('welcomePane').style.display = 'none';
  document.getElementById('activeChatArea').classList.remove('hidden');
  document.getElementById('activeChatArea').style.display = 'flex';

  applyAvatar(document.getElementById('chatHeaderAvatar'), {
    url: chatType === 'group' ? null : meta.avatarUrl,
    color: meta.avatarColor,
    name: meta.name,
    isGroup: chatType === 'group',
  });
  document.getElementById('chatHeaderName').textContent = meta.name;
  document.getElementById('chatHeaderSub').textContent = meta.sub || '';

  document.getElementById('msgSearchBar').classList.add('hidden');
  document.getElementById('msgSearchResults').classList.add('hidden');
  cancelReply();
  cancelEdit();
  document.getElementById('typingIndicator').innerHTML = '';
  typingUsers.clear();

  socket.emit('chat:join', { chatType, chatId });

  const messagesArea = document.getElementById('messagesArea');
  messagesArea.innerHTML = '<div class="empty-state">Loading messages...</div>';
  messagesRendered.clear();
  messagesData.clear();

  try {
    const res = await Api.get(`/api/messages/${chatType}/${chatId}/history?limit=40`);
    messagesArea.innerHTML = '';
    let lastDate = null;
    res.messages.forEach((m) => {
      const dateLabel = formatDateLabel(m.created_at);
      if (dateLabel !== lastDate) {
        appendDateSeparator(dateLabel);
        lastDate = dateLabel;
      }
      appendMessage(m, false);
    });
    scrollToBottom();
    socket.emit('chat:seen', { chatType, chatId });
    await loadConversations();
    if (chatType === 'group') await loadGroups();
  } catch (err) {
    messagesArea.innerHTML = `<div class="empty-state">Failed to load messages.</div>`;
    Toast.error(err.message);
  }
}

// Actually reverts the UI from chat view back to the list. Does NOT touch
// browser history itself — call backToList()/exitChat() instead if the
// action originates from a user click, so history stays in sync.
function closeChatView() {
  document.getElementById('chatApp').classList.remove('view-chat');
  document.getElementById('chatApp').classList.add('view-list');
  markActiveInList(null);
}

// Exit the currently open chat and return to the chat list.
// If we pushed a history entry when opening the chat, go back through it
// (this fires the popstate handler below, which does the actual UI revert).
// Otherwise (e.g. no history entry yet) just revert the UI directly.
function backToList() {
  if (chatHistoryPushed && history.state && history.state.scsChatOpen) {
    history.back();
  } else {
    closeChatView();
  }
}

// Alias with a clearer name for the "exit chat" action.
function exitChat() {
  backToList();
}

// Hardware/browser back button (and swipe-back gestures on mobile) should
// close an open chat instead of navigating away from the app or exiting.
window.addEventListener('popstate', () => {
  chatHistoryPushed = false;
  if (document.getElementById('chatApp').classList.contains('view-chat')) {
    closeChatView();
  }
});

// Accessibility: Escape closes the message context menu, then any open
// modal, and only then (on mobile/desktop) exits the chat back to the list.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;

  const menu = document.getElementById('msgContextMenu');
  if (menu && !menu.classList.contains('hidden')) {
    closeMsgContextMenu();
    return;
  }

  const activeModal = document.querySelector('.modal-overlay:not(.hidden)');
  if (activeModal) {
    activeModal.classList.add('hidden');
    return;
  }

  if (document.getElementById('chatApp').classList.contains('view-chat')) {
    backToList();
  }
});

function appendDateSeparator(label) {
  const div = document.createElement('div');
  div.className = 'date-sep';
  div.innerHTML = `<span>${label}</span>`;
  document.getElementById('messagesArea').appendChild(div);
}

function scrollToBottom() {
  const area = document.getElementById('messagesArea');
  area.scrollTop = area.scrollHeight;
}

// ============================================================
// RENDER A SINGLE MESSAGE
// ============================================================
function buildTicks(msg) {
  if (msg.sender_id !== me.id) return '';
  let icon = '✓';
  let color = 'inherit';
  if (msg.status === 'delivered') icon = '✓✓';
  if (msg.status === 'seen') { icon = '✓✓'; color = '#22d3ee'; }
  return `<span class="msg-ticks" style="color:${color}">${icon}</span>`;
}

function fileIconFor(type) {
  return { image: '🖼️', video: '🎬', audio: '🎵', pdf: '📄', zip: '🗜️', apk: '📱', file: '📎' }[type] || '📎';
}

function renderMessageBody(m) {
  if (m.is_deleted) {
    const mine = m.deleted_by === me.id;
    return `<div class="msg-deleted">${mine ? 'You deleted this message.' : 'This message was deleted.'}</div>`;
  }
  let replyHtml = '';
  if (m.reply_to_id && m.reply_content !== null && m.reply_content !== undefined) {
    replyHtml = `<div class="msg-reply-ref"><b>${escapeHtml(m.reply_sender_name || '')}</b><br>${escapeHtml((m.reply_content || '').slice(0, 80))}</div>`;
  } else if (m.reply_to_id) {
    replyHtml = `<div class="msg-reply-ref"><i>Original message unavailable</i></div>`;
  }

  if (m.message_type === 'text' || !m.message_type) {
    return `${replyHtml}<div>${escapeHtml(m.content)}</div>`;
  }
  if (m.message_type === 'image') {
    return `${replyHtml}<img class="msg-image" src="${m.file_url}" onclick="openMedia('image','${m.file_url}')" loading="lazy">`;
  }
  if (m.message_type === 'video') {
    return `${replyHtml}<video class="msg-video" src="${m.file_url}" controls></video>`;
  }
  if (m.message_type === 'audio') {
    return `${replyHtml}${buildVoicePlayer(m)}`;
  }
  // pdf, zip, apk, file
  return `${replyHtml}<a href="${m.file_url}" download="${escapeHtml(m.file_name || '')}" style="color:inherit;text-decoration:none;">
    <div class="msg-file">
      <div class="msg-file-icon">${fileIconFor(m.message_type)}</div>
      <div class="msg-file-info">
        <div class="msg-file-name">${escapeHtml(m.file_name || 'File')}</div>
        <div class="msg-file-size">${formatFileSize(m.file_size)} · Tap to download</div>
      </div>
    </div>
  </a>`;
}

function appendMessage(m, animate = true, prepend = false) {
  const area = document.getElementById('messagesArea');
  const mine = m.sender_id === me.id;

  const row = document.createElement('div');
  row.className = `msg-row ${mine ? 'mine' : 'theirs'}`;
  row.dataset.messageId = m.id;
  if (!animate) row.style.animation = 'none';

  const showSenderName = activeChat.type === 'group' && !mine;

  row.innerHTML = `
    <div class="msg-bubble-wrap">
      ${showSenderName ? `<div class="msg-sender-name">${escapeHtml(m.sender_display_name)}</div>` : ''}
      <div class="msg-bubble">
        ${renderMessageBody(m)}
        ${!m.is_deleted ? `<div class="msg-meta">
          ${m.is_edited ? '<span class="msg-edited-tag">edited</span>' : ''}
          <span>${formatClock(m.created_at)}</span>
          ${buildTicks(m)}
        </div>` : ''}
      </div>
    </div>
  `;

  if (prepend) area.insertBefore(row, area.firstChild);
  else area.appendChild(row);

  messagesRendered.set(m.id, row);
  messagesData.set(m.id, m);
  if (!m.is_deleted) bindMessageRowEvents(row, m.id);

  if (mine === false) {
    socket.emit('message:delivered', { messageId: m.id, chatType: activeChat.type, chatId: activeChat.id });
  }
}

// ============================================================
// MESSAGE CONTEXT MENU (long-press on mobile, right-click on desktop)
// WhatsApp-style: Reply / Edit / Copy / Star / Forward / Message Info /
// Delete for Me / Delete for Everyone / Cancel
// ============================================================
function bindMessageRowEvents(row, messageId) {
  let pressTimer = null;
  let moved = false;

  const start = (e) => {
    moved = false;
    const point = e.touches ? e.touches[0] : e;
    const x = point.clientX, y = point.clientY;
    pressTimer = setTimeout(() => {
      if (!moved) openMsgContextMenu(messageId, x, y);
    }, 450);
  };
  const cancelPress = () => { clearTimeout(pressTimer); };
  const onMove = () => { moved = true; clearTimeout(pressTimer); };

  row.addEventListener('touchstart', start, { passive: true });
  row.addEventListener('touchend', cancelPress);
  row.addEventListener('touchmove', onMove, { passive: true });
  row.addEventListener('mousedown', start);
  row.addEventListener('mouseup', cancelPress);
  row.addEventListener('mouseleave', cancelPress);
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    clearTimeout(pressTimer);
    openMsgContextMenu(messageId, e.clientX, e.clientY);
  });
}

function openMsgContextMenu(messageId, x, y) {
  const m = messagesData.get(messageId);
  if (!m || m.is_deleted) return;

  contextMenuMessageId = messageId;
  const mine = m.sender_id === me.id;
  const menu = document.getElementById('msgContextMenu');

  menu.querySelector('[data-action="edit"]').classList.toggle('hidden', !(mine && (m.message_type === 'text' || !m.message_type)));
  menu.querySelector('[data-action="deleteEveryone"]').classList.toggle('hidden', !(mine || me.role === 'admin'));
  document.getElementById('mcmStarLabel').textContent = starredMessages.has(messageId) ? 'Unstar Message' : 'Star Message';

  document.getElementById('mcmBackdrop').classList.remove('hidden');

  const isMobile = window.innerWidth <= 768;
  menu.classList.toggle('as-sheet', isMobile);
  if (isMobile) {
    menu.style.left = '0';
    menu.style.top = '';
  } else {
    const menuWidth = 220, menuHeight = 340;
    menu.style.left = Math.min(x, window.innerWidth - menuWidth - 12) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - menuHeight - 12) + 'px';
  }
  menu.classList.remove('hidden');
}

function closeMsgContextMenu() {
  document.getElementById('msgContextMenu').classList.add('hidden');
  document.getElementById('mcmBackdrop').classList.add('hidden');
  contextMenuMessageId = null;
}

function handleMsgContextAction(action) {
  const messageId = contextMenuMessageId;
  closeMsgContextMenu();
  if (!messageId) return;

  switch (action) {
    case 'reply': startReply(messageId); break;
    case 'edit': startEdit(messageId); break;
    case 'copy': copyMessageText(messageId); break;
    case 'star': toggleStarMessage(messageId); break;
    case 'forward': openForwardModal(messageId); break;
    case 'info': openMessageInfo(messageId); break;
    case 'deleteMe': requestDeleteForMe(messageId); break;
    case 'deleteEveryone': requestDeleteForEveryone(messageId); break;
    default: break;
  }
}

async function copyMessageText(messageId) {
  const m = messagesData.get(messageId);
  if (!m) return;
  const text = (m.message_type === 'text' || !m.message_type) ? (m.content || '') : (m.file_name || '');
  try {
    await navigator.clipboard.writeText(text);
    Toast.success('Copied to clipboard.');
  } catch (e) {
    Toast.error('Could not copy.');
  }
}

function toggleStarMessage(messageId) {
  const row = messagesRendered.get(messageId);
  if (starredMessages.has(messageId)) {
    starredMessages.delete(messageId);
    if (row) row.classList.remove('starred');
    Toast.info('Message unstarred.');
  } else {
    starredMessages.add(messageId);
    if (row) row.classList.add('starred');
    Toast.success('Message starred.');
  }
}

function openForwardModal(messageId) {
  contextMenuMessageId = messageId; // reused after modal closes
  const list = document.getElementById('forwardTargetsList');
  const rows = [];

  conversationsCache.forEach((c) => {
    rows.push(`
      <div class="member-row" onclick="forwardMessage('private','${c.id}','${messageId}')">
        <div class="avatar sm" style="${avatarStyle(c.other_avatar_color)}">${avatarGlyph(c.other_avatar_url, c.other_display_name, false)}${avatarImgTag(c.other_avatar_url)}</div>
        <div style="font-weight:600;font-size:13.5px;">${escapeHtml(c.other_display_name)}</div>
      </div>`);
  });
  groupsCache.forEach((g) => {
    rows.push(`
      <div class="member-row" onclick="forwardMessage('group','${g.id}','${messageId}')">
        <div class="avatar sm" style="background:${g.avatar_color || '#6366f1'}">👥</div>
        <div style="font-weight:600;font-size:13.5px;">${escapeHtml(g.name)}</div>
      </div>`);
  });

  list.innerHTML = rows.length ? rows.join('') : `<div class="empty-state">No chats to forward to yet.</div>`;
  openModal('forwardModal');
}

function forwardMessage(targetType, targetId, messageId) {
  const m = messagesData.get(messageId);
  if (!m) return;
  closeModal('forwardModal');

  socket.emit('message:send', {
    chatType: targetType,
    chatId: targetId,
    content: m.content,
    messageType: m.message_type || 'text',
    fileUrl: m.file_url,
    fileName: m.file_name,
    fileSize: m.file_size,
  }, (ack) => {
    if (ack.success) Toast.success('Message forwarded.');
    else Toast.error(ack.message || 'Failed to forward message.');
  });
}

async function openMessageInfo(messageId) {
  const body = document.getElementById('msgInfoBody');
  body.innerHTML = `<div class="empty-state">Loading...</div>`;
  openModal('msgInfoModal');
  try {
    const res = await Api.get(`/api/messages/info/${messageId}`);
    const info = res.info;
    const fmtWho = (arr) => arr.length ? arr.map((r) => `${escapeHtml(r.name)} · ${formatClock(r.at)}`).join('<br>') : '—';
    body.innerHTML = `
      <div class="msginfo-row"><span class="msginfo-label">Sent</span><span>${formatClock(info.sentAt)}</span></div>
      <div class="msginfo-row"><span class="msginfo-label">Delivered to</span><span style="text-align:right;">${fmtWho(info.delivered)}</span></div>
      <div class="msginfo-row"><span class="msginfo-label">Seen by</span><span style="text-align:right;">${fmtWho(info.seen)}</span></div>
      <div class="msginfo-row"><span class="msginfo-label">Edited</span><span>${info.isEdited ? 'Yes' : 'No'}</span></div>
      <div class="msginfo-row"><span class="msginfo-label">Deleted</span><span>${info.isDeleted ? 'Yes' : 'No'}</span></div>
      <div class="msginfo-row"><span class="msginfo-label">Encrypted</span><span>Transport (HTTPS/WSS)</span></div>
    `;
  } catch (err) {
    body.innerHTML = `<div class="empty-state">Could not load message info.</div>`;
  }
}

function requestDeleteForEveryone(messageId) {
  if (!confirm('Delete this message for everyone?')) return;
  socket.emit('message:delete', { messageId, chatType: activeChat.type, chatId: activeChat.id, forEveryone: true }, (ack) => {
    if (!ack.success) Toast.error(ack.message || 'Failed to delete message.');
  });
}

function requestDeleteForMe(messageId) {
  const row = messagesRendered.get(messageId);
  socket.emit('message:delete', { messageId, chatType: activeChat.type, chatId: activeChat.id, forEveryone: false }, (ack) => {
    if (!ack.success) {
      Toast.error(ack.message || 'Failed to delete message.');
      return;
    }
    if (row) row.classList.add('msg-hiding');
    showUndoSnackbar(messageId, row);
  });
}

function showUndoSnackbar(messageId, row) {
  if (pendingUndo) finalizePendingDelete();

  const snackbar = document.getElementById('undoSnackbar');
  snackbar.classList.remove('hidden');

  pendingUndo = {
    messageId,
    timeoutId: setTimeout(() => {
      snackbar.classList.add('hidden');
      finalizePendingDelete();
    }, 5000),
  };

  function finalizePendingDeleteLocal() {
    if (row && row.parentNode) row.parentNode.removeChild(row);
    messagesRendered.delete(messageId);
    messagesData.delete(messageId);
    pendingUndo = null;
  }
  pendingUndo.finalize = finalizePendingDeleteLocal;
}

function finalizePendingDelete() {
  if (pendingUndo && pendingUndo.finalize) {
    clearTimeout(pendingUndo.timeoutId);
    pendingUndo.finalize();
  }
  document.getElementById('undoSnackbar').classList.add('hidden');
  pendingUndo = null;
}

function undoDelete() {
  if (!pendingUndo) return;
  const { messageId, timeoutId } = pendingUndo;
  clearTimeout(timeoutId);
  document.getElementById('undoSnackbar').classList.add('hidden');
  pendingUndo = null;

  socket.emit('message:undoDelete', { messageId }, (ack) => {
    if (ack.success) {
      const row = messagesRendered.get(messageId);
      if (row) row.classList.remove('msg-hiding');
      Toast.success('Message restored.');
    } else {
      Toast.error(ack.message || 'Failed to undo.');
    }
  });
}

function onIncomingMessage(m) {
  const belongsToActive = activeChat && activeChat.type === m.chat_type && activeChat.id === m.chat_id;
  if (belongsToActive) {
    appendMessage(m);
    scrollToBottom();
    if (m.sender_id !== me.id) {
      socket.emit('chat:seen', { chatType: activeChat.type, chatId: activeChat.id });
    }
  }
  loadConversations();
  if (m.chat_type === 'group') loadGroups();
}

function onMessageEdited(m) {
  messagesData.set(m.id, m);
  const row = messagesRendered.get(m.id);
  if (row) {
    const bubble = row.querySelector('.msg-bubble');
    bubble.innerHTML = `${renderMessageBody(m)}<div class="msg-meta"><span class="msg-edited-tag">edited</span><span>${formatClock(m.created_at)}</span>${buildTicks(m)}</div>`;
  }
}

function onMessageDeleted({ messageId, forEveryone, message }) {
  const row = messagesRendered.get(messageId);

  if (forEveryone) {
    if (message) messagesData.set(messageId, message);
    if (row) {
      const bubble = row.querySelector('.msg-bubble');
      bubble.innerHTML = renderMessageBody(message || { is_deleted: true, deleted_by: null });
    }
  } else {
    // "Delete for me" - only ever broadcast to this user's own sockets/tabs.
    // Soft-hide (collapsing animation); the initiating tab additionally
    // manages the undo snackbar via requestDeleteForMe()'s own callback.
    if (row) row.classList.add('msg-hiding');
  }
}

function onMessageRestored({ messageId }) {
  if (pendingUndo && pendingUndo.messageId === messageId) return; // already handled by undoDelete()
  const row = messagesRendered.get(messageId);
  if (row) row.classList.remove('msg-hiding');
}

function onMessageStatus({ messageId, status }) {
  const row = messagesRendered.get(messageId);
  if (!row) return;
  const ticks = row.querySelector('.msg-ticks');
  if (ticks && status === 'delivered') ticks.textContent = '✓✓';
}

function onChatSeen({ chatType, chatId }) {
  if (!activeChat || activeChat.type !== chatType || activeChat.id !== chatId) return;
  messagesRendered.forEach((row, id) => {
    if (row.classList.contains('mine')) {
      const ticks = row.querySelector('.msg-ticks');
      if (ticks) { ticks.textContent = '✓✓'; ticks.style.color = '#22d3ee'; }
    }
  });
}

// ============================================================
// COMPOSER: send / reply / edit / typing
// ============================================================
function startReply(messageId) {
  const row = messagesRendered.get(messageId);
  if (!row) return;
  const bubbleText = row.querySelector('.msg-bubble div')?.textContent || '[Attachment]';
  const senderName = row.classList.contains('mine') ? 'yourself' : (row.querySelector('.msg-sender-name')?.textContent || activeChat.name);
  replyTarget = { id: messageId, text: bubbleText, sender: senderName };
  document.getElementById('replyToName').textContent = senderName;
  document.getElementById('replyPreviewText').textContent = bubbleText;
  document.getElementById('replyPreview').classList.remove('hidden');
  cancelEdit();
  document.getElementById('composerInput').focus();
}
function cancelReply() {
  replyTarget = null;
  document.getElementById('replyPreview').classList.add('hidden');
}

function startEdit(messageId) {
  const row = messagesRendered.get(messageId);
  if (!row) return;
  const text = row.querySelector('.msg-bubble div')?.textContent || '';
  editTarget = messageId;
  const input = document.getElementById('composerInput');
  input.value = text;
  input.focus();
  document.getElementById('editPreview').classList.remove('hidden');
  cancelReply();
  updateSendBtn();
}
function cancelEdit() {
  editTarget = null;
  document.getElementById('editPreview').classList.add('hidden');
}

function updateSendBtn() {
  const val = document.getElementById('composerInput').value.trim();
  document.getElementById('composerAction').classList.toggle('has-text', val.length > 0);
}

function sendTextMessage() {
  const input = document.getElementById('composerInput');
  const content = input.value.trim();
  if (!content || !activeChat) return;

  if (editTarget) {
    socket.emit('message:edit', { messageId: editTarget, chatType: activeChat.type, chatId: activeChat.id, content }, (ack) => {
      if (!ack.success) Toast.error(ack.message || 'Failed to edit message.');
    });
    cancelEdit();
  } else {
    socket.emit('message:send', {
      chatType: activeChat.type,
      chatId: activeChat.id,
      content,
      messageType: 'text',
      replyToId: replyTarget ? replyTarget.id : null,
    }, (ack) => {
      if (!ack.success) Toast.error(ack.message || 'Failed to send message.');
    });
    cancelReply();
  }

  input.value = '';
  input.style.height = 'auto';
  updateSendBtn();
  stopTyping();
}

function notifyTyping() {
  if (!activeChat) return;
  socket.emit('typing:start', { chatType: activeChat.type, chatId: activeChat.id });
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(stopTyping, 2000);
}
function stopTyping() {
  if (!activeChat) return;
  clearTimeout(typingTimeout);
  socket.emit('typing:stop', { chatType: activeChat.type, chatId: activeChat.id });
}

function onTypingUpdate({ chatType, chatId, userId, displayName, isTyping }) {
  if (!activeChat || activeChat.type !== chatType || activeChat.id !== chatId) return;
  if (isTyping) typingUsers.set(userId, displayName);
  else typingUsers.delete(userId);

  const el = document.getElementById('typingIndicator');
  if (typingUsers.size === 0) {
    el.innerHTML = '';
    return;
  }
  const names = Array.from(typingUsers.values()).slice(0, 2).join(', ');
  el.innerHTML = `<span>${escapeHtml(names)} typing</span><span class="typing-dots"><span></span><span></span><span></span></span>`;
}

function onPresenceUpdate({ userId, isOnline, lastSeen }) {
  onlineStatusCache.set(userId, { isOnline, lastSeen });
  if (activeChat && activeChat.type === 'private' && activeChat.otherUserId === userId) {
    document.getElementById('chatHeaderSub').textContent = isOnline ? 'online' : (lastSeen ? 'Last seen ' + timeAgo(lastSeen) : 'offline');
  }
  loadConversations();
}

async function onNotification({ chatType, chatId, from, preview }) {
  const isActiveChat = activeChat && activeChat.type === chatType && activeChat.id === chatId;
  const isMuted = mutedChatKeys.has(`${chatType}:${chatId}`);
  if (!isActiveChat && !isMuted) {
    // If this browser/device has a live Web Push subscription, the server
    // (see socket.js notifyRecipientPush) already sends a real push for
    // this exact event when the tab is backgrounded - the service worker
    // will show it. Also firing the local Notification here would show it
    // TWICE. Only use the local fallback when push isn't actively covering
    // this device (permission not granted, unsupported browser, or the
    // server has no VAPID keys configured).
    const pushWillHandleIt = await Push.isSubscribed();
    if (!pushWillHandleIt) {
      showBrowserNotification(from, preview);
    }
    Toast.info(`${from}: ${preview}`);
  }
  loadConversations();
  if (chatType === 'group') loadGroups();
}

// ============================================================
// REALTIME PROFILE UPDATE
// Fired whenever anyone visible to this session (self on another device,
// a 1:1 chat partner, or a shared group member) changes their nickname or
// picture. Patches every place their avatar/name is shown - no refresh.
// ============================================================
function onProfileUpdated({ userId, displayName, avatarUrl, avatarColor }) {
  // Own account, updated from another tab/device.
  if (me && userId === me.id) {
    me = { ...me, displayName, avatarUrl, avatarColor };
    document.getElementById('meName').textContent = displayName;
    applyAvatar(document.getElementById('meAvatar'), { url: avatarUrl, color: avatarColor, name: displayName });
  }

  // Sidebar chat list (private conversations).
  let touchedList = false;
  conversationsCache.forEach((c) => {
    if (c.other_user_id === userId) {
      c.other_display_name = displayName;
      c.other_avatar_url = avatarUrl;
      c.other_avatar_color = avatarColor;
      touchedList = true;
    }
  });
  if (touchedList) renderChatList(lastUnreadMap);

  // Currently open chat header (1:1 chat with this person).
  if (activeChat && activeChat.type === 'private' && activeChat.otherUserId === userId) {
    activeChat.name = displayName;
    activeChat.avatarUrl = avatarUrl;
    activeChat.avatarColor = avatarColor;
    document.getElementById('chatHeaderName').textContent = displayName;
    applyAvatar(document.getElementById('chatHeaderAvatar'), { url: avatarUrl, color: avatarColor, name: displayName });
  }

  // Any user-search results currently on screen (e.g. "new chat" picker).
  document.querySelectorAll(`[data-user-id="${userId}"] .avatar`).forEach((el) => {
    applyAvatar(el, { url: avatarUrl, color: avatarColor, name: displayName });
  });
  document.querySelectorAll(`[data-user-id="${userId}"] .user-result-name`).forEach((el) => {
    el.textContent = displayName;
  });
}

// ============================================================
// EMOJI PICKER
// ============================================================
function buildEmojiPanel() {
  const panel = document.getElementById('emojiPanel');
  panel.innerHTML = EMOJIS.map((e) => `<button type="button" onclick="insertEmoji('${e}')">${e}</button>`).join('');
}
function insertEmoji(emoji) {
  const input = document.getElementById('composerInput');
  input.value += emoji;
  input.focus();
  updateSendBtn();
}
function toggleEmojiPanel() {
  document.getElementById('emojiPanel').classList.toggle('hidden');
}

// ============================================================
// FILE UPLOAD
// ============================================================
// ============================================================
// FLOATING BUTTON RIPPLE (material-style press feedback)
// ============================================================
function bindFloatingButtonRipples() {
  document.querySelectorAll('.floating-btn').forEach((btn) => {
    btn.addEventListener('pointerdown', (e) => {
      const rect = btn.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const span = document.createElement('span');
      span.className = 'ripple';
      span.style.width = span.style.height = `${size}px`;
      span.style.left = `${(e.clientX ?? rect.left + rect.width / 2) - rect.left - size / 2}px`;
      span.style.top = `${(e.clientY ?? rect.top + rect.height / 2) - rect.top - size / 2}px`;
      btn.appendChild(span);
      span.addEventListener('animationend', () => span.remove());
    });
  });
}

// ============================================================
// MOBILE KEYBOARD FIX
// On iOS/Android, the on-screen keyboard overlays the page instead of
// resizing the layout viewport, so a plain height:100% column can end
// up with its last child (the composer) hidden behind the keyboard.
// window.visualViewport reports the REAL visible area, so we mirror
// that onto the app shell's height. Only active below the 992px
// mobile breakpoint; desktop is left completely alone.
// ============================================================
function bindMobileKeyboardFix() {
  if (!window.visualViewport) return;
  const appEl = document.getElementById('chatApp');
  const mq = window.matchMedia('(max-width: 992px)');

  function applyViewportHeight() {
    if (!mq.matches) {
      appEl.style.height = '';
      return;
    }
    appEl.style.height = window.visualViewport.height + 'px';
    // Keep the page itself from scrolling under the fixed-height shell
    // (some Android keyboards nudge document scroll on focus).
    window.scrollTo(0, 0);
  }

  window.visualViewport.addEventListener('resize', applyViewportHeight);
  window.visualViewport.addEventListener('scroll', applyViewportHeight);
  mq.addEventListener ? mq.addEventListener('change', applyViewportHeight) : mq.addListener(applyViewportHeight);

  // Re-pin scroll to the latest message whenever the keyboard opens,
  // so the user doesn't lose their place in the conversation.
  document.getElementById('composerInput').addEventListener('focus', () => {
    if (!mq.matches) return;
    setTimeout(() => {
      applyViewportHeight();
      const area = document.getElementById('messagesArea');
      if (area) area.scrollTop = area.scrollHeight;
    }, 250);
  });

  applyViewportHeight();
}

async function handleFileSelected(file) {
  if (!file || !activeChat) return;
  const maxMb = 50;
  if (file.size > maxMb * 1024 * 1024) {
    Toast.error(`File too large. Max ${maxMb}MB.`);
    return;
  }

  const formData = new FormData();
  formData.append('file', file);

  showUploadStatus(file.name);
  try {
    const res = await Api.uploadFile('/api/uploads', formData, setUploadProgress);
    dismissUploadStatus();
    socket.emit('message:send', {
      chatType: activeChat.type,
      chatId: activeChat.id,
      messageType: res.file.type,
      content: res.file.name,
      fileUrl: res.file.url,
      fileName: res.file.name,
      fileSize: res.file.size,
      replyToId: replyTarget ? replyTarget.id : null,
    }, (ack) => {
      if (!ack.success) Toast.error(ack.message || 'Failed to send file.');
    });
    cancelReply();
  } catch (err) {
    lastFailedUpload = { file };
    uploadFailed();
    Toast.error(err.data?.message || err.message || 'Upload failed.');
  }
  document.getElementById('fileInput').value = ''; // allow re-picking the same file after a retry
}

// ============================================================
// UPLOAD PROGRESS / RETRY BAR (shared by file attachments + voice messages)
// ============================================================
let lastFailedUpload = null;

function showUploadStatus(label) {
  const bar = document.getElementById('uploadStatusBar');
  if (!bar) return;
  bar.classList.remove('hidden');
  document.getElementById('uploadStatusName').textContent = label;
  document.getElementById('uploadStatusFill').style.width = '0%';
  document.getElementById('uploadStatusRetry').classList.add('hidden');
}
function setUploadProgress(pct) {
  const fill = document.getElementById('uploadStatusFill');
  if (fill) fill.style.width = `${pct}%`;
}
function uploadFailed() {
  document.getElementById('uploadStatusRetry').classList.remove('hidden');
}
function dismissUploadStatus() {
  document.getElementById('uploadStatusBar').classList.add('hidden');
  lastFailedUpload = null;
}
function retryLastUpload() {
  if (!lastFailedUpload) return;
  const { file } = lastFailedUpload;
  lastFailedUpload = null;
  handleFileSelected(file);
}

// ============================================================
// VOICE MESSAGE RECORDING (MediaRecorder) + CUSTOM PLAYER
// ============================================================
let mediaRecorder = null;
let recordedChunks = [];
let recordingStartTime = null;
let recordingTimerInterval = null;
const MAX_RECORDING_SECONDS = 5 * 60;

async function toggleVoiceRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') return;
  if (!activeChat) {
    Toast.error('Open a chat first.');
    return;
  }
  if (!navigator.mediaDevices || !window.MediaRecorder) {
    Toast.error('Voice recording is not supported in this browser.');
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    Toast.error('Microphone access was denied.');
    return;
  }

  const mimeType = ['audio/webm', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
  recordedChunks = [];
  mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  mediaRecorder.addEventListener('dataavailable', (e) => {
    if (e.data && e.data.size > 0) recordedChunks.push(e.data);
  });
  mediaRecorder.start();
  recordingStartTime = Date.now();

  document.getElementById('micBtn').classList.add('recording');
  document.getElementById('recordingBar').classList.remove('hidden');
  updateRecordingTime();
  recordingTimerInterval = setInterval(updateRecordingTime, 250);
}

function updateRecordingTime() {
  const secs = Math.floor((Date.now() - recordingStartTime) / 1000);
  document.getElementById('recordingTime').textContent = formatDuration(secs);
  if (secs >= MAX_RECORDING_SECONDS) stopAndSendVoiceRecording();
}

function stopRecordingUI() {
  clearInterval(recordingTimerInterval);
  recordingTimerInterval = null;
  document.getElementById('micBtn').classList.remove('recording');
  document.getElementById('recordingBar').classList.add('hidden');
}

function cancelVoiceRecording() {
  if (!mediaRecorder) return;
  const stream = mediaRecorder.stream;
  mediaRecorder.onstop = () => stream && stream.getTracks().forEach((t) => t.stop());
  mediaRecorder.stop();
  recordedChunks = [];
  mediaRecorder = null;
  stopRecordingUI();
}

function stopAndSendVoiceRecording() {
  if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
  const durationSeconds = Math.round((Date.now() - recordingStartTime) / 1000);
  const mimeType = mediaRecorder.mimeType || 'audio/webm';
  const stream = mediaRecorder.stream;
  mediaRecorder.onstop = async () => {
    stream && stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(recordedChunks, { type: mimeType });
    recordedChunks = [];
    mediaRecorder = null;
    await sendVoiceMessage(blob, durationSeconds, mimeType);
  };
  mediaRecorder.stop();
  stopRecordingUI();
}

async function sendVoiceMessage(blob, durationSeconds, mimeType) {
  if (!activeChat) return;
  if (!blob.size) {
    Toast.error('Recording was empty.');
    return;
  }
  const ext = mimeType.includes('ogg') ? 'ogg' : 'webm';
  const fileName = `voice-${Date.now()}.${ext}`;
  const file = new File([blob], fileName, { type: mimeType });
  const formData = new FormData();
  formData.append('file', file);

  showUploadStatus('Voice message');
  try {
    const res = await Api.uploadFile('/api/uploads', formData, setUploadProgress);
    dismissUploadStatus();
    socket.emit('message:send', {
      chatType: activeChat.type,
      chatId: activeChat.id,
      messageType: 'audio',
      content: fileName,
      fileUrl: res.file.url,
      fileName,
      fileSize: res.file.size,
      duration: durationSeconds,
      replyToId: replyTarget ? replyTarget.id : null,
    }, (ack) => {
      if (!ack.success) Toast.error(ack.message || 'Failed to send voice message.');
    });
    cancelReply();
  } catch (err) {
    lastFailedUpload = null; // re-recording is simpler than re-sending a blob
    Toast.error(err.data?.message || err.message || 'Voice message upload failed.');
  }
}

// Deterministic pseudo-random bar heights from the message id, so a given
// voice message always renders the same "waveform" shape across reloads.
const WAVE_BAR_COUNT = 27;
function waveformBars(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const bars = [];
  for (let i = 0; i < WAVE_BAR_COUNT; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    bars.push(28 + (h % 72)); // 28-99% bar height
  }
  return bars;
}

function buildVoicePlayer(m) {
  const bars = waveformBars(m.id);
  const barsHtml = bars.map((p) => `<span class="msg-voice-bar" style="height:${p}%"></span>`).join('');
  return `
    <div class="msg-voice" data-voice-id="${m.id}" data-src="${m.file_url}">
      <button type="button" class="msg-voice-play" onclick="toggleVoicePlayback('${m.id}')">▶</button>
      <div class="msg-voice-body">
        <div class="msg-voice-wave" onclick="seekVoice(event, '${m.id}')">
          ${barsHtml}
          <div class="msg-voice-wave-fill" style="width:0%">${barsHtml}</div>
        </div>
        <div class="msg-voice-meta">
          <span class="msg-voice-elapsed">0:00</span>
          <span class="msg-voice-duration">${formatDuration(m.duration)}</span>
        </div>
      </div>
      <a class="msg-voice-download" href="${m.file_url}" download title="Download">⬇</a>
    </div>`;
}

// A single shared <audio> element is reused across all voice bubbles, so
// starting playback on one message pauses whichever other one was playing -
// same behaviour as WhatsApp/Telegram voice notes.
let activeVoiceAudio = null;
let activeVoiceId = null;

function toggleVoicePlayback(id) {
  const wrap = document.querySelector(`.msg-voice[data-voice-id="${id}"]`);
  if (!wrap) return;

  if (activeVoiceId === id && activeVoiceAudio) {
    if (activeVoiceAudio.paused) activeVoiceAudio.play();
    else activeVoiceAudio.pause();
    return;
  }

  if (activeVoiceAudio) {
    activeVoiceAudio.pause();
    resetVoiceUI(activeVoiceId);
  }

  activeVoiceId = id;
  activeVoiceAudio = new Audio(wrap.dataset.src);
  activeVoiceAudio.preload = 'metadata';
  activeVoiceAudio.addEventListener('timeupdate', () => updateVoiceProgress(id));
  activeVoiceAudio.addEventListener('play', () => setVoicePlayIcon(id, '⏸'));
  activeVoiceAudio.addEventListener('pause', () => setVoicePlayIcon(id, '▶'));
  activeVoiceAudio.addEventListener('ended', () => resetVoiceUI(id));
  activeVoiceAudio.play().catch(() => Toast.error('Could not play voice message.'));
}

function resetVoiceUI(id) {
  setVoicePlayIcon(id, '▶');
  updateVoiceProgressPct(id, 0);
  setVoiceElapsed(id, 0);
}
function setVoicePlayIcon(id, icon) {
  const wrap = document.querySelector(`.msg-voice[data-voice-id="${id}"]`);
  if (wrap) wrap.querySelector('.msg-voice-play').textContent = icon;
}
function updateVoiceProgress(id) {
  if (!activeVoiceAudio || activeVoiceId !== id || !activeVoiceAudio.duration) return;
  updateVoiceProgressPct(id, (activeVoiceAudio.currentTime / activeVoiceAudio.duration) * 100);
  setVoiceElapsed(id, activeVoiceAudio.currentTime);
}
function updateVoiceProgressPct(id, pct) {
  const wrap = document.querySelector(`.msg-voice[data-voice-id="${id}"]`);
  if (wrap) wrap.querySelector('.msg-voice-wave-fill').style.width = `${pct}%`;
}
function setVoiceElapsed(id, seconds) {
  const wrap = document.querySelector(`.msg-voice[data-voice-id="${id}"]`);
  if (wrap) wrap.querySelector('.msg-voice-elapsed').textContent = formatDuration(seconds);
}
function seekVoice(evt, id) {
  if (activeVoiceId !== id || !activeVoiceAudio || !activeVoiceAudio.duration) return;
  const rect = evt.currentTarget.getBoundingClientRect();
  const pct = Math.min(1, Math.max(0, (evt.clientX - rect.left) / rect.width));
  activeVoiceAudio.currentTime = pct * activeVoiceAudio.duration;
}

// ============================================================
// MEDIA LOADER: fullscreen image preview - zoom, download, share
// ============================================================
let mediaZoomLevel = 1;
function openMedia(type, url) {
  const modal = document.getElementById('mediaModal');
  const content = document.getElementById('mediaModalContent');
  mediaZoomLevel = 1;
  if (type === 'image') {
    content.innerHTML = `
      <div class="media-modal-toolbar">
        <button type="button" onclick="zoomMedia(-0.25)" title="Zoom out">−</button>
        <button type="button" onclick="zoomMedia(0.25)" title="Zoom in">+</button>
        <button type="button" onclick="downloadMedia('${url}')" title="Download">⬇</button>
        <button type="button" onclick="shareMedia('${url}')" title="Share">↗</button>
      </div>
      <div class="media-modal-img-wrap"><img id="mediaModalImg" src="${url}"></div>`;
  }
  modal.classList.remove('hidden');
}

function zoomMedia(delta) {
  const img = document.getElementById('mediaModalImg');
  if (!img) return;
  mediaZoomLevel = Math.min(4, Math.max(1, mediaZoomLevel + delta));
  img.style.transform = `scale(${mediaZoomLevel})`;
}

function downloadMedia(url) {
  const a = document.createElement('a');
  a.href = url;
  a.download = url.split('/').pop();
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function shareMedia(url) {
  const absoluteUrl = new URL(url, window.location.origin).href;
  if (navigator.share) {
    try {
      await navigator.share({ url: absoluteUrl });
    } catch (e) { /* user cancelled the share sheet */ }
    return;
  }
  try {
    await navigator.clipboard.writeText(absoluteUrl);
    Toast.success('Link copied to clipboard.');
  } catch (e) {
    Toast.error('Sharing is not supported on this browser.');
  }
}

// ============================================================
// MODAL HELPERS
// ============================================================
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

function switchNewTab(tab) {
  document.getElementById('newTabChat').classList.toggle('active', tab === 'chat');
  document.getElementById('newTabGroup').classList.toggle('active', tab === 'group');
  document.getElementById('newChatPane').classList.toggle('hidden', tab !== 'chat');
  document.getElementById('newGroupPane').classList.toggle('hidden', tab !== 'group');
}
function switchGroupTab(tab) {
  document.getElementById('grpTabCreate').classList.toggle('active', tab === 'create');
  document.getElementById('grpTabJoin').classList.toggle('active', tab === 'join');
  document.getElementById('createGroupForm').classList.toggle('hidden', tab !== 'create');
  document.getElementById('joinGroupForm').classList.toggle('hidden', tab !== 'join');
}

// ---- Search users for new private chat ----
let userSearchDebounce = null;
function bindNewChatSearch() {
  document.getElementById('newChatSearch').addEventListener('input', (e) => {
    clearTimeout(userSearchDebounce);
    const term = e.target.value.trim();
    const resultsEl = document.getElementById('newChatResults');
    if (term.length < 1) { resultsEl.innerHTML = ''; return; }
    userSearchDebounce = setTimeout(async () => {
      const res = await Api.get(`/api/users/search?q=${encodeURIComponent(term)}`);
      resultsEl.innerHTML = res.users.length
        ? res.users.map((u) => `
          <div class="member-row" data-user-id="${u.id}" onclick="startPrivateChat('${u.id}')">
            <div class="avatar sm" style="${avatarStyle(u.avatar_color)}">${avatarGlyph(u.avatar_url, u.display_name, false)}${avatarImgTag(u.avatar_url)}</div>
            <div>
              <div class="user-result-name" style="font-weight:600;font-size:13.5px;">${escapeHtml(u.display_name)}</div>
              <div style="font-size:12px;color:var(--text-secondary);">@${escapeHtml(u.username)}</div>
            </div>
          </div>`).join('')
        : `<div class="empty-state">No users found.</div>`;
    }, 300);
  });
}

async function startPrivateChat(userId) {
  const res = await Api.post('/api/users/conversations/start', { userId });
  closeModal('newModal');
  await loadConversations();
  switchSidebarTab('chats');
  const ou = res.conversation.otherUser;
  openChat('private', res.conversation.id, {
    name: ou.displayName,
    sub: ou.isOnline ? 'online' : 'offline',
    avatarColor: ou.avatarColor,
    avatarUrl: ou.avatarUrl,
    otherUserId: ou.id,
  });
}

// ---- Global sidebar search (people + groups combined) ----
let sidebarSearchDebounce = null;
function bindSidebarSearch() {
  const input = document.getElementById('userSearchInput');
  const panel = document.getElementById('searchResultsPanel');
  input.addEventListener('input', () => {
    clearTimeout(sidebarSearchDebounce);
    const term = input.value.trim();
    if (term.length < 1) { panel.classList.add('hidden'); return; }
    sidebarSearchDebounce = setTimeout(async () => {
      const res = await Api.get(`/api/users/search?q=${encodeURIComponent(term)}`);
      panel.classList.remove('hidden');
      panel.innerHTML = res.users.length
        ? res.users.map((u) => `
          <div class="search-hit" onclick="startPrivateChat('${u.id}'); document.getElementById('searchResultsPanel').classList.add('hidden'); document.getElementById('userSearchInput').value='';">
            <div class="search-hit-name">@${escapeHtml(u.username)}</div>
            <div class="search-hit-text">${escapeHtml(u.display_name)}</div>
          </div>`).join('')
        : `<div class="empty-state">No matches.</div>`;
    }, 300);
  });
  document.addEventListener('click', (e) => {
    if (!panel.contains(e.target) && e.target !== input) panel.classList.add('hidden');
  });
}

// ---- In-chat message search ----
function toggleMsgSearch() {
  const bar = document.getElementById('msgSearchBar');
  bar.classList.toggle('hidden');
  if (!bar.classList.contains('hidden')) document.getElementById('msgSearchInput').focus();
  else document.getElementById('msgSearchResults').classList.add('hidden');
}
let msgSearchDebounce = null;
function bindMsgSearch() {
  document.getElementById('msgSearchInput').addEventListener('input', (e) => {
    clearTimeout(msgSearchDebounce);
    const term = e.target.value.trim();
    const panel = document.getElementById('msgSearchResults');
    if (term.length < 1 || !activeChat) { panel.classList.add('hidden'); return; }
    msgSearchDebounce = setTimeout(async () => {
      const res = await Api.get(`/api/messages/${activeChat.type}/${activeChat.id}/search?q=${encodeURIComponent(term)}`);
      panel.classList.remove('hidden');
      panel.innerHTML = res.messages.length
        ? res.messages.map((m) => `
          <div class="search-hit" onclick="jumpToMessage('${m.id}')">
            <div class="search-hit-name">${escapeHtml(m.sender_display_name)} · ${formatClock(m.created_at)}</div>
            <div class="search-hit-text">${escapeHtml((m.content || '').slice(0, 100))}</div>
          </div>`).join('')
        : `<div class="empty-state">No messages found.</div>`;
    }, 300);
  });
}
function jumpToMessage(messageId) {
  const row = messagesRendered.get(messageId);
  if (row) {
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.style.outline = '2px solid var(--accent)';
    setTimeout(() => (row.style.outline = 'none'), 1500);
  }
  document.getElementById('msgSearchResults').classList.add('hidden');
}

// ---- Info modal (group members / private chat info) ----
async function openInfoModal() {
  if (!activeChat) return;
  const body = document.getElementById('infoModalBody');

  if (activeChat.type === 'private') {
    body.innerHTML = `
      <div style="text-align:center;padding:10px 0 20px;">
        <div class="avatar" style="width:76px;height:76px;font-size:26px;margin:0 auto 12px;${avatarStyle(activeChat.avatarColor)}">${avatarGlyph(activeChat.avatarUrl, activeChat.name, false)}${avatarImgTag(activeChat.avatarUrl)}</div>
        <div style="font-weight:700;font-size:17px;">${escapeHtml(activeChat.name)}</div>
        <div style="color:var(--text-secondary);font-size:13px;margin-top:4px;">${escapeHtml(activeChat.sub)}</div>
      </div>`;
  } else {
    body.innerHTML = `<div class="empty-state">Loading members...</div>`;
    const res = await Api.get(`/api/groups/${activeChat.id}/members`);
    body.innerHTML = `
      <div style="text-align:center;margin-bottom:14px;">
        <div class="avatar" style="width:70px;height:70px;font-size:24px;margin:0 auto 10px;background:${activeChat.avatarColor}">👥</div>
        <div style="font-weight:700;font-size:16px;">${escapeHtml(activeChat.name)}</div>
        <div style="color:var(--text-secondary);font-size:12.5px;">${res.members.length} members</div>
      </div>
      <div style="max-height:280px;overflow-y:auto;">
        ${res.members.map((m) => `
          <div class="member-row">
            <div class="avatar sm" style="${avatarStyle(m.avatar_color)}">
              ${avatarGlyph(m.avatar_url, m.display_name, false)}
              ${avatarImgTag(m.avatar_url)}
              <span class="status-dot ${m.is_online ? 'online' : ''}"></span>
            </div>
            <div style="flex:1;">
              <div style="font-weight:600;font-size:13.5px;">${escapeHtml(m.display_name)} ${m.id === me.id ? '(you)' : ''}</div>
              <div style="font-size:11.5px;color:var(--text-secondary);">${m.role} · ${m.is_online ? 'online' : 'Last seen ' + timeAgo(m.last_seen)}</div>
            </div>
          </div>`).join('')}
      </div>
      <button class="btn btn-danger" style="width:100%;margin-top:16px;" onclick="leaveCurrentGroup()">Leave Group</button>
    `;
  }
  openModal('infoModal');
}

async function leaveCurrentGroup() {
  if (!activeChat || activeChat.type !== 'group') return;
  if (!confirm('Leave this group?')) return;
  await Api.post(`/api/groups/${activeChat.id}/leave`);
  socket.emit('group:left', { groupId: activeChat.id });
  closeModal('infoModal');
  backToList();
  activeChat = null;
  document.getElementById('welcomePane').style.display = 'flex';
  document.getElementById('activeChatArea').classList.add('hidden');
  document.getElementById('activeChatArea').style.display = 'none';
  await loadGroups();
}

// ============================================================
// GLOBAL UI BINDINGS
// ============================================================
function bindGlobalUI() {
  buildEmojiPanel();
  bindNewChatSearch();
  bindSidebarSearch();
  bindMsgSearch();
  bindFloatingButtonRipples();
  bindMobileKeyboardFix();

  document.getElementById('fabNew').addEventListener('click', () => {
    document.getElementById('newChatSearch').value = '';
    document.getElementById('newChatResults').innerHTML = '';
    switchNewTab('chat');
    openModal('newModal');
  });

  document.getElementById('profileForm').addEventListener('submit', saveProfile);
  document.getElementById('msgContextMenu').addEventListener('click', (e) => {
    const item = e.target.closest('.mcm-item');
    if (item) handleMsgContextAction(item.dataset.action);
  });
  document.getElementById('profileAvatarInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    handleProfileAvatarSelected(file);
    e.target.value = '';
  });

  const composer = document.getElementById('composerInput');
  composer.addEventListener('input', () => {
    updateSendBtn();
    notifyTyping();
    composer.style.height = 'auto';
    composer.style.height = composer.scrollHeight + 'px'; // CSS max-height (~5 lines) caps this and adds internal scroll
  });
  composer.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendTextMessage();
    }
  });

  document.getElementById('sendBtn').addEventListener('click', sendTextMessage);
  document.getElementById('emojiBtn').addEventListener('click', toggleEmojiPanel);
  document.getElementById('attachBtn').addEventListener('click', () => document.getElementById('fileInput').click());
  document.getElementById('micBtn').addEventListener('click', toggleVoiceRecording);
  document.getElementById('fileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    handleFileSelected(file);
    e.target.value = '';
  });

  document.getElementById('createGroupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('createGroupError');
    errorEl.textContent = '';
    try {
      const name = document.getElementById('grpName').value.trim();
      const description = document.getElementById('grpDesc').value.trim();
      const password = document.getElementById('grpPassword').value;
      const res = await Api.post('/api/groups/create', { name, description, password });
      Toast.success('Group created!');
      closeModal('newModal');
      e.target.reset();
      await loadGroups();
      switchSidebarTab('groups');
      socket.emit('group:joined', { groupId: res.group.id });
      openChat('group', res.group.id, { name: res.group.name, sub: 'Group · you are the owner', avatarColor: res.group.avatarColor });
    } catch (err) {
      errorEl.textContent = err.data?.message || err.message;
    }
  });

  document.getElementById('joinGroupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('joinGroupError');
    errorEl.textContent = '';
    try {
      const name = document.getElementById('joinGrpName').value.trim();
      const password = document.getElementById('joinGrpPassword').value;
      const res = await Api.post('/api/groups/join', { name, password });
      Toast.success(`Joined "${res.group.name}"!`);
      closeModal('newModal');
      e.target.reset();
      await loadGroups();
      switchSidebarTab('groups');
      socket.emit('group:joined', { groupId: res.group.id });
      openChat('group', res.group.id, { name: res.group.name, sub: 'Group', avatarColor: res.group.avatarColor });
    } catch (err) {
      errorEl.textContent = err.data?.message || err.message;
    }
  });

  // Close emoji panel on outside click
  document.addEventListener('click', (e) => {
    const panel = document.getElementById('emojiPanel');
    const btn = document.getElementById('emojiBtn');
    if (!panel.contains(e.target) && e.target !== btn) panel.classList.add('hidden');
  });

  // Refresh presence/last-seen labels periodically
  setInterval(() => {
    if (activeChat && activeChat.type === 'private') {
      const status = onlineStatusCache.get(activeChat.otherUserId);
      if (status && !status.isOnline && status.lastSeen) {
        document.getElementById('chatHeaderSub').textContent = 'Last seen ' + timeAgo(status.lastSeen);
      }
    }
  }, 30000);
}
