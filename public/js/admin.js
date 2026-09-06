/**
 * admin.js - Admin dashboard logic.
 * Loads stats, users, groups, and activity logs; supports ban/unban and
 * deleting groups / conversation history.
 */
let adminMe = null;

async function bootstrapAdmin() {
  try {
    const res = await Api.get('/api/auth/me');
    adminMe = res.user;
    if (adminMe.role !== 'admin') {
      window.location.href = '/chat';
      return;
    }
  } catch (err) {
    window.location.href = '/';
    return;
  }

  await Promise.all([loadStats(), loadUsers(), loadGroups(), loadLogs(), loadRegisteredAccounts()]);
}

function switchAdminTab(tab) {
  document.querySelectorAll('.admin-tab').forEach((el) => el.classList.toggle('active', el.dataset.tab === tab));
  document.getElementById('panelUsers').classList.toggle('hidden', tab !== 'users');
  document.getElementById('panelGroups').classList.toggle('hidden', tab !== 'groups');
  document.getElementById('panelLogs').classList.toggle('hidden', tab !== 'logs');
  document.getElementById('panelAccounts').classList.toggle('hidden', tab !== 'accounts');
}

async function loadStats() {
  const res = await Api.get('/api/admin/stats');
  const grid = document.getElementById('statGrid');
  grid.innerHTML = `
    <div class="stat-card glass"><div class="stat-value">${res.stats.totalUsers}</div><div class="stat-label">Total Users</div></div>
    <div class="stat-card glass"><div class="stat-value">${res.stats.totalGroups}</div><div class="stat-label">Total Groups</div></div>
    <div class="stat-card glass"><div class="stat-value">${res.stats.totalMessages}</div><div class="stat-label">Total Messages</div></div>
  `;
}

async function loadUsers() {
  const res = await Api.get('/api/admin/users?limit=200');
  const panel = document.getElementById('panelUsers');
  if (res.users.length === 0) {
    panel.innerHTML = `<div class="empty-state">No users found.</div>`;
    return;
  }
  panel.innerHTML = res.users.map((u) => `
    <div class="table-row">
      <div class="col" style="flex:2;">
        <b>${escapeHtml(u.display_name)}</b> <span style="color:var(--text-secondary);">@${escapeHtml(u.username)}</span>
        ${u.role === 'admin' ? '<span class="badge admin">ADMIN</span>' : ''}
      </div>
      <div class="col">${u.is_online ? '<span class="badge online">Online</span>' : `<span class="badge offline">Offline</span>`}</div>
      <div class="col">${u.is_banned ? `<span class="badge banned">Banned${u.banned_reason ? ': ' + escapeHtml(u.banned_reason) : ''}</span>` : '—'}</div>
      <div class="col" style="flex:0 0 auto;">
        ${u.role !== 'admin' ? (u.is_banned
          ? `<button class="btn btn-ghost" style="padding:6px 12px;font-size:12px;" onclick="unbanUser('${u.id}')">Unban</button>`
          : `<button class="btn btn-danger" style="padding:6px 12px;font-size:12px;" onclick="banUser('${u.id}')">Ban</button>`)
          : ''}
      </div>
    </div>
  `).join('');
}

async function banUser(userId) {
  const reason = prompt('Reason for ban (optional):') || '';
  try {
    await Api.post(`/api/admin/users/${userId}/ban`, { reason });
    Toast.success('User banned.');
    await loadUsers();
  } catch (err) {
    Toast.error(err.data?.message || err.message);
  }
}

async function unbanUser(userId) {
  try {
    await Api.post(`/api/admin/users/${userId}/unban`);
    Toast.success('User unbanned.');
    await loadUsers();
  } catch (err) {
    Toast.error(err.data?.message || err.message);
  }
}

async function loadGroups() {
  const res = await Api.get('/api/admin/groups?limit=200');
  const panel = document.getElementById('panelGroups');
  if (res.groups.length === 0) {
    panel.innerHTML = `<div class="empty-state">No groups found.</div>`;
    return;
  }
  panel.innerHTML = res.groups.map((g) => `
    <div class="table-row">
      <div class="col" style="flex:2;"><b>${escapeHtml(g.name)}</b></div>
      <div class="col">${g.member_count} members</div>
      <div class="col">${new Date(g.created_at).toLocaleDateString()}</div>
      <div class="col" style="flex:0 0 auto;">
        <button class="btn btn-danger" style="padding:6px 12px;font-size:12px;" onclick="deleteGroup('${g.id}', '${escapeHtml(g.name)}')">Delete</button>
      </div>
    </div>
  `).join('');
}

async function deleteGroup(groupId, name) {
  if (!confirm(`Delete group "${name}"? This removes all its messages permanently.`)) return;
  try {
    await Api.del(`/api/admin/groups/${groupId}`);
    Toast.success('Group deleted.');
    await Promise.all([loadGroups(), loadStats()]);
  } catch (err) {
    Toast.error(err.data?.message || err.message);
  }
}

async function loadLogs() {
  const res = await Api.get('/api/admin/logs?limit=150');
  const panel = document.getElementById('panelLogs');
  if (res.logs.length === 0) {
    panel.innerHTML = `<div class="empty-state">No activity yet.</div>`;
    return;
  }
  panel.innerHTML = res.logs.map((l) => `
    <div class="table-row">
      <div class="col" style="flex:0 0 140px;">${new Date(l.created_at).toLocaleString()}</div>
      <div class="col" style="flex:0 0 140px;"><b>${escapeHtml(l.action)}</b></div>
      <div class="col">${escapeHtml(l.username || 'system')}</div>
      <div class="col" style="flex:2;color:var(--text-secondary);font-size:11.5px;">${escapeHtml((l.details || '').slice(0, 120))}</div>
    </div>
  `).join('');
}

/**
 * Registered Accounts panel (Super Admin only).
 *
 * NOTE ON PASSWORDS: this panel intentionally never displays or exports
 * real password or password-hash values. The API only ever returns a
 * fixed "Protected" status for that column. Showing/exporting bcrypt
 * hashes in bulk would let anyone with dashboard access — or anyone who
 * later got hold of an exported file — run offline cracking attempts
 * against every account. So the "Copy Stored Password Value" feature is
 * deliberately not implemented; the copy button below copies the
 * username only, as usernames aren't sensitive credential material.
 */
const accountsState = {
  search: '',
  sort: 'DESC',
  limit: 10,
  offset: 0,
  total: 0,
  rows: [],
};

async function loadRegisteredAccounts() {
  const panel = document.getElementById('panelAccounts');
  const params = new URLSearchParams({
    search: accountsState.search,
    sort: accountsState.sort,
    limit: accountsState.limit,
    offset: accountsState.offset,
  });

  let res;
  try {
    res = await Api.get(`/api/admin/registered-accounts?${params.toString()}`);
  } catch (err) {
    panel.innerHTML = `<div class="empty-state">Failed to load accounts: ${escapeHtml(err.data?.message || err.message)}</div>`;
    return;
  }

  accountsState.rows = res.accounts;
  accountsState.total = res.total;

  renderAccountsPanel();
}

function renderAccountsPanel() {
  const panel = document.getElementById('panelAccounts');
  const { rows, total, limit, offset, search, sort } = accountsState;
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + limit, total);
  const sortArrow = sort === 'ASC' ? '▲' : '▼';

  panel.innerHTML = `
    <div class="accounts-toolbar">
      <input type="text" class="accounts-search" id="accountsSearchInput" placeholder="Search by username..." value="${escapeHtml(search)}">
      <button class="btn btn-ghost" style="padding:8px 14px;font-size:12px;" onclick="refreshAccounts()">🔄 Refresh</button>
      <button class="btn btn-ghost" style="padding:8px 14px;font-size:12px;" onclick="exportAccounts('csv')">⬇ Export CSV</button>
      <button class="btn btn-ghost" style="padding:8px 14px;font-size:12px;" onclick="exportAccounts('json')">⬇ Export JSON</button>
    </div>
    ${rows.length === 0 ? '<div class="empty-state">No registered accounts found.</div>' : `
    <div class="accounts-table-wrap">
      <table class="accounts-table">
        <thead>
          <tr>
            <th>Photo</th>
            <th>Full Name</th>
            <th>Username</th>
            <th>Password</th>
            <th>User ID</th>
            <th class="sortable" onclick="toggleAccountsSort()">Registration Date ${sortArrow}</th>
            <th>Last Login</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(renderAccountRow).join('')}
        </tbody>
      </table>
    </div>
    <div class="accounts-pagination">
      <div class="accounts-pagination-info">Showing ${start}–${end} of ${total}</div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-ghost" style="padding:6px 12px;font-size:12px;" ${offset === 0 ? 'disabled' : ''} onclick="accountsPage(-1)">← Prev</button>
        <button class="btn btn-ghost" style="padding:6px 12px;font-size:12px;" ${offset + limit >= total ? 'disabled' : ''} onclick="accountsPage(1)">Next →</button>
      </div>
    </div>
    `}
  `;

  const searchInput = document.getElementById('accountsSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', debounceAccountsSearch);
  }
}

function renderAccountRow(u) {
  // If the picture 404s (e.g. removed from the host's disk after a
  // redeploy/restart), fall back to the initial-letter avatar instead of
  // leaving a broken image icon. Both layers are always rendered; onerror
  // just toggles which one is visible, so there's no HTML-in-attribute
  // quoting to worry about.
  const initial = escapeHtml((u.displayName || u.username || '?').charAt(0).toUpperCase());
  const fallbackHtml = `<div class="accounts-avatar-fallback" style="background:${escapeHtml(u.avatarColor || '#6366f1')};display:${u.avatarUrl ? 'none' : 'flex'};">${initial}</div>`;
  const imgHtml = u.avatarUrl
    ? `<img class="accounts-avatar" src="${escapeHtml(u.avatarUrl)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">`
    : '';
  const avatar = `${imgHtml}${fallbackHtml}`;

  return `
    <tr>
      <td>${avatar}</td>
      <td><b>${escapeHtml(u.displayName)}</b>${u.role === 'admin' ? ' <span class="badge admin">ADMIN</span>' : ''}</td>
      <td>@${escapeHtml(u.username)} <button class="copy-btn" onclick="copyAccountsField('${escapeAttr(u.username)}', this)">Copy</button></td>
      <td><span class="badge protected">🔒 Protected</span></td>
      <td style="font-family:monospace;font-size:11.5px;color:var(--text-secondary);">${escapeHtml(u.id)}</td>
      <td>${new Date(u.registeredAt).toLocaleString()}</td>
      <td>${u.lastSeen ? new Date(u.lastSeen).toLocaleString() : '—'}</td>
      <td>${u.isOnline ? '<span class="badge online">Online</span>' : '<span class="badge offline">Offline</span>'}</td>
    </tr>
  `;
}

let accountsSearchDebounce = null;
function debounceAccountsSearch(e) {
  clearTimeout(accountsSearchDebounce);
  const value = e.target.value;
  accountsSearchDebounce = setTimeout(() => {
    accountsState.search = value;
    accountsState.offset = 0;
    loadRegisteredAccounts();
  }, 300);
}

function toggleAccountsSort() {
  accountsState.sort = accountsState.sort === 'ASC' ? 'DESC' : 'ASC';
  accountsState.offset = 0;
  loadRegisteredAccounts();
}

function accountsPage(direction) {
  accountsState.offset = Math.max(0, accountsState.offset + direction * accountsState.limit);
  loadRegisteredAccounts();
}

function refreshAccounts() {
  loadRegisteredAccounts();
}

function copyAccountsField(value, btnEl) {
  navigator.clipboard.writeText(value).then(() => {
    if (btnEl) {
      const original = btnEl.textContent;
      btnEl.textContent = 'Copied!';
      setTimeout(() => { btnEl.textContent = original; }, 1200);
    }
    Toast.success('Copied to clipboard.');
  }).catch(() => Toast.error('Could not copy.'));
}

function exportAccounts(format) {
  const rows = accountsState.rows;
  if (!rows.length) {
    Toast.error('Nothing to export on this page.');
    return;
  }

  // Password values are never included in exports — only the fixed
  // "Protected" status, matching what's shown in the table.
  const exportRows = rows.map((u) => ({
    fullName: u.displayName,
    username: u.username,
    password: 'Protected',
    userId: u.id,
    registrationDate: u.registeredAt,
    lastLogin: u.lastSeen || '',
    status: u.isOnline ? 'Online' : 'Offline',
  }));

  let blob, filename;
  if (format === 'json') {
    blob = new Blob([JSON.stringify(exportRows, null, 2)], { type: 'application/json' });
    filename = 'registered-accounts.json';
  } else {
    const headers = ['fullName', 'username', 'password', 'userId', 'registrationDate', 'lastLogin', 'status'];
    const csvEscape = (val) => `"${String(val).replace(/"/g, '""')}"`;
    const lines = [headers.join(',')].concat(
      exportRows.map((r) => headers.map((h) => csvEscape(r[h])).join(','))
    );
    blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    filename = 'registered-accounts.csv';
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function escapeAttr(str) {
  return String(str).replace(/'/g, "\\'");
}

document.addEventListener('DOMContentLoaded', bootstrapAdmin);
