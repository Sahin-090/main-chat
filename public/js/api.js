/**
 * api.js - thin fetch wrapper shared by every page.
 * Handles JSON, credentials (httpOnly cookies), and CSRF token header.
 */
const Api = (() => {
  let csrfToken = null;

  function getCookie(name) {
    const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  async function ensureCsrf() {
    csrfToken = getCookie('csrf_token');
    if (csrfToken) return csrfToken;
    const res = await fetchOnce('/api/auth/csrf-token', { credentials: 'include' });
    const data = await res.json();
    csrfToken = data.csrfToken;
    return csrfToken;
  }

  const REQUEST_TIMEOUT_MS = 20000; // tolerant of slow mobile networks
  const MAX_NETWORK_RETRIES = 2; // only for idempotent GET requests

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function fetchOnce(url, fetchOpts) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { ...fetchOpts, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async function request(method, url, body, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    let payload = body;

    if (!(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      payload = body ? JSON.stringify(body) : undefined;
    }

    if (method !== 'GET') {
      await ensureCsrf();
      headers['X-CSRF-Token'] = csrfToken;
    }

    const fetchOpts = {
      method,
      headers,
      body: payload,
      credentials: 'include',
    };

    let res;
    let attempt = 0;
    // Only GET is safe to auto-retry on a genuine network failure - retrying
    // POST/PUT/PATCH/DELETE could duplicate a side effect (e.g. sending a
    // message twice) if the first attempt actually reached the server.
    const maxAttempts = method === 'GET' ? MAX_NETWORK_RETRIES + 1 : 1;

    while (true) {
      try {
        res = await fetchOnce(url, fetchOpts);
        break;
      } catch (networkErr) {
        attempt += 1;
        const isAbort = networkErr.name === 'AbortError';
        if (attempt >= maxAttempts) {
          const err = new Error(
            isAbort
              ? 'Request timed out. Please check your connection and try again.'
              : 'Network error. Please check your connection and try again.'
          );
          err.status = 0;
          err.networkError = true;
          throw err;
        }
        await sleep(300 * Math.pow(3, attempt - 1)); // 300ms, 900ms...
      }
    }

    let data;
    try {
      data = await res.json();
    } catch (e) {
      data = { success: res.ok, message: res.statusText };
    }

    if (!res.ok) {
      const err = new Error(data.message || 'Request failed');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // Uses XMLHttpRequest instead of fetch so we get real upload progress
  // events (fetch has no upload progress API) - used for the upload
  // progress bar / retry flow and for voice-message uploads.
  function uploadFile(url, formData, onProgress) {
    return new Promise((resolve, reject) => {
      ensureCsrf().then((token) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.withCredentials = true;
        xhr.setRequestHeader('X-CSRF-Token', token);
        xhr.upload.onprogress = (e) => {
          if (onProgress && e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => {
          let data;
          try {
            data = JSON.parse(xhr.responseText);
          } catch (e) {
            data = { success: false, message: 'Invalid server response.' };
          }
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(data);
          } else {
            const err = new Error(data.message || 'Upload failed');
            err.status = xhr.status;
            err.data = data;
            reject(err);
          }
        };
        xhr.onerror = () => {
          const err = new Error('Network error during upload.');
          err.networkError = true;
          reject(err);
        };
        xhr.send(formData);
      }).catch(reject);
    });
  }

  return {
    get: (url) => request('GET', url),
    post: (url, body) => request('POST', url, body),
    put: (url, body) => request('PUT', url, body),
    patch: (url, body) => request('PATCH', url, body),
    del: (url, body) => request('DELETE', url, body),
    uploadFile,
    ensureCsrf,
  };
})();
