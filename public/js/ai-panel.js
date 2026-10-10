/**
 * ai-panel.js
 * ------------------------------------------------------------
 * The AI Assistant's chat interface. Loaded lazily by ai-assistant.js the
 * first time the user taps the floating icon.
 *
 * Talks directly to the Cloudflare Worker (browser -> Worker -> Groq) using
 * the request shape { message, context, history }. The Worker URL comes
 * from /api/public-config (not a secret - just avoids hardcoding it twice).
 *
 * Security notes:
 * - No password/token/secret ever leaves this file; the only thing sent is
 *   whatever window.ScsAI.getContext() returns, which is itself built in
 *   chat.js from data this user is already authorized to see on screen.
 * - History is cached client-side only, per authenticated user id, and is
 *   wiped on logout (see chat.js) so it never carries across accounts on a
 *   shared browser.
 * ------------------------------------------------------------
 */
window.ScsAIPanel = (function () {
  const MAX_HISTORY_TURNS = 20; // sent to the Worker
  const MAX_STORED_MESSAGES = 40; // kept in localStorage

  let overlayEl = null;
  let bodyEl = null;
  let inputEl = null;
  let sendBtnEl = null;
  let stopBtnEl = null;

  let messages = []; // { role: 'user'|'assistant', content, ts, error? }
  let workerUrlPromise = null;
  let activeController = null; // AbortController for the in-flight request
  let sending = false;

  function buildContext() {
    const fromChat = (window.ScsAI && window.ScsAI.getContext) ? window.ScsAI.getContext() : null;
    if (fromChat) return Object.assign({ authenticated: true, route: window.location.pathname }, fromChat);
    // No chat.js on this page (e.g. the login/register screen) - the user
    // isn't authenticated yet, so give the assistant only generic,
    // non-personal context instead of nothing.
    return { authenticated: false, route: window.location.pathname };
  }

  function historyKey() {
    const ctx = buildContext();
    const userId = ctx && ctx.user ? ctx.user.id : 'anon';
    return `scs_ai_history_${userId}`;
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(historyKey());
      messages = raw ? JSON.parse(raw) : [];
    } catch (e) {
      messages = [];
    }
  }

  function saveHistory() {
    try {
      localStorage.setItem(historyKey(), JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)));
    } catch (e) {
      /* storage full/unavailable - conversation still works for this session */
    }
  }

  async function getWorkerUrl() {
    if (!workerUrlPromise) {
      workerUrlPromise = fetch(Api.resolve('/api/public-config'), { credentials: 'include' })
        .then((r) => r.json())
        .then((d) => d.aiWorkerUrl)
        .catch(() => {
          workerUrlPromise = null; // allow retry next time
          throw new Error('config-unavailable');
        });
    }
    return workerUrlPromise;
  }

  // ---- Minimal, safe Markdown renderer (no external dependency) ----------
  // Escapes everything first, then re-introduces a small, whitelisted set
  // of Markdown constructs as real tags, so nothing the model outputs can
  // inject arbitrary HTML.
  function renderMarkdown(raw) {
    const escaped = escapeHtml(raw);
    const codeBlocks = [];
    let text = escaped.replace(/```([a-zA-Z0-9]*)\n([\s\S]*?)```/g, (m, lang, code) => {
      const idx = codeBlocks.length;
      codeBlocks.push(code.replace(/\n$/, ''));
      return `\u0000CODEBLOCK${idx}\u0000`;
    });

    text = text
      .replace(/^#### (.*)$/gm, '<h4>$1</h4>')
      .replace(/^### (.*)$/gm, '<h4>$1</h4>')
      .replace(/^## (.*)$/gm, '<h4>$1</h4>')
      .replace(/^# (.*)$/gm, '<h4>$1</h4>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*(?!\*)([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/`([^`\n]+)`/g, '<code class="ai-inline-code">$1</code>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    // Lists: group consecutive "- "/"* " or "1. " lines into <ul>/<ol>
    const lines = text.split('\n');
    const out = [];
    let listType = null;
    for (const line of lines) {
      const bulletMatch = line.match(/^\s*[-*]\s+(.*)$/);
      const numberedMatch = line.match(/^\s*\d+\.\s+(.*)$/);
      if (bulletMatch) {
        if (listType !== 'ul') { if (listType) out.push(`</${listType}>`); out.push('<ul>'); listType = 'ul'; }
        out.push(`<li>${bulletMatch[1]}</li>`);
      } else if (numberedMatch) {
        if (listType !== 'ol') { if (listType) out.push(`</${listType}>`); out.push('<ol>'); listType = 'ol'; }
        out.push(`<li>${numberedMatch[1]}</li>`);
      } else {
        if (listType) { out.push(`</${listType}>`); listType = null; }
        out.push(line);
      }
    }
    if (listType) out.push(`</${listType}>`);
    text = out.join('\n');

    // Paragraph breaks for remaining plain lines
    text = text
      .split(/\n{2,}/)
      .map((block) => (/^\s*<(h4|ul|ol)/.test(block) ? block : `<p>${block.replace(/\n/g, '<br>')}</p>`))
      .join('');

    text = text.replace(/\u0000CODEBLOCK(\d+)\u0000/g, (m, idx) => {
      const code = codeBlocks[Number(idx)];
      return `<div class="ai-code-block"><button type="button" class="ai-copy-btn" data-copy-index="${idx}">Copy</button><pre><code>${code}</code></pre></div>`;
    });

    return { html: text, codeBlocks };
  }

  // ---- DOM construction ---------------------------------------------------
  function buildDom() {
    overlayEl = document.createElement('div');
    overlayEl.className = 'ai-panel-overlay hidden';
    overlayEl.id = 'aiPanelOverlay';
    overlayEl.innerHTML = `
      <div class="ai-panel glass" role="dialog" aria-label="AI Assistant">
        <div class="ai-panel-header">
          <span class="ai-panel-header-icon" aria-hidden="true">🤖</span>
          <span class="ai-panel-header-title">AI Assistant</span>
          <button type="button" class="btn-icon" id="aiPanelClose" aria-label="Close AI Assistant">✕</button>
        </div>
        <div class="ai-panel-body" id="aiPanelBody"></div>
        <div class="ai-panel-composer">
          <textarea id="aiPanelInput" class="ai-panel-input" rows="1" maxlength="4000"
            placeholder="Ask about your account, chats, groups…"></textarea>
          <button type="button" id="aiPanelStop" class="ai-panel-send-btn ai-panel-stop-btn hidden" aria-label="Stop generating">⏹</button>
          <button type="button" id="aiPanelSend" class="ai-panel-send-btn" aria-label="Send">➤</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlayEl);

    bodyEl = overlayEl.querySelector('#aiPanelBody');
    inputEl = overlayEl.querySelector('#aiPanelInput');
    sendBtnEl = overlayEl.querySelector('#aiPanelSend');
    stopBtnEl = overlayEl.querySelector('#aiPanelStop');

    overlayEl.querySelector('#aiPanelClose').addEventListener('click', close);
    overlayEl.addEventListener('click', (e) => { if (e.target === overlayEl) close(); });
    sendBtnEl.addEventListener('click', handleSend);
    stopBtnEl.addEventListener('click', handleStop);

    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });
    inputEl.addEventListener('input', () => {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
    });

    bodyEl.addEventListener('click', (e) => {
      const copyBtn = e.target.closest('.ai-copy-btn');
      if (!copyBtn) return;
      const pre = copyBtn.parentElement.querySelector('pre');
      const text = pre ? pre.textContent : '';
      navigator.clipboard?.writeText(text).then(() => {
        const original = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = original; }, 1500);
      });
    });
  }

  function renderMessages() {
    if (messages.length === 0) {
      bodyEl.innerHTML = `<div class="ai-empty-state">👋 Ask me anything about your account, chats, groups, or how to use a feature.</div>`;
      return;
    }
    bodyEl.innerHTML = messages
      .map((m) => {
        if (m.role === 'user') {
          return `<div class="ai-msg ai-msg--user"><div class="ai-msg-bubble">${escapeHtml(m.content)}</div></div>`;
        }
        if (m.error) {
          return `<div class="ai-msg ai-msg--assistant ai-msg--error">
            <div class="ai-msg-bubble">${escapeHtml(m.content)}</div>
            <button type="button" class="ai-retry-btn" data-retry="1">Retry</button>
          </div>`;
        }
        const { html } = renderMarkdown(m.content);
        return `<div class="ai-msg ai-msg--assistant"><div class="ai-msg-bubble ai-markdown">${html}</div></div>`;
      })
      .join('');

    bodyEl.querySelectorAll('[data-retry]').forEach((btn) => {
      btn.addEventListener('click', retryLast);
    });
    scrollToBottom();
  }

  function scrollToBottom() {
    requestAnimationFrame(() => { bodyEl.scrollTop = bodyEl.scrollHeight; });
  }

  function setSending(isSending) {
    sending = isSending;
    sendBtnEl.classList.toggle('hidden', isSending);
    stopBtnEl.classList.toggle('hidden', !isSending);
    inputEl.disabled = isSending;
  }

  function showTyping() {
    const typing = document.createElement('div');
    typing.className = 'ai-msg ai-msg--assistant ai-msg--typing';
    typing.id = 'aiTypingIndicator';
    typing.innerHTML = `<div class="ai-msg-bubble"><span class="ai-typing-dot"></span><span class="ai-typing-dot"></span><span class="ai-typing-dot"></span></div>`;
    bodyEl.appendChild(typing);
    scrollToBottom();
  }

  function removeTyping() {
    document.getElementById('aiTypingIndicator')?.remove();
  }

  async function handleSend() {
    const text = inputEl.value.trim();
    if (!text || sending) return;
    inputEl.value = '';
    inputEl.style.height = 'auto';

    messages.push({ role: 'user', content: text, ts: Date.now() });
    saveHistory();
    renderMessages();
    await requestReply();
  }

  function retryLast() {
    if (sending) return;
    // Drop the trailing error bubble, keep the last user message, resend.
    if (messages.length && messages[messages.length - 1].role === 'assistant') {
      messages.pop();
      saveHistory();
    }
    renderMessages();
    requestReply();
  }

  async function requestReply() {
    setSending(true);
    showTyping();
    activeController = new AbortController();

    try {
      const workerUrl = await getWorkerUrl();
      const context = buildContext();
      const history = messages
        .filter((m) => !m.error)
        .slice(-MAX_HISTORY_TURNS)
        .map((m) => ({ role: m.role, content: m.content }));
      // Drop the just-added current message from history (it's sent as `message`).
      history.pop();

      const lastUserMessage = messages[messages.length - 1].content;

      const res = await fetch(workerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: lastUserMessage, context, history }),
        signal: activeController.signal,
      });

      let data = null;
      try { data = await res.json(); } catch (e) { /* handled below */ }

      if (!res.ok || !data || !data.reply) {
        const friendly = (data && data.error) || 'AI Assistant is temporarily unavailable. Please try again.';
        removeTyping();
        messages.push({ role: 'assistant', content: friendly, error: true, ts: Date.now() });
        saveHistory();
        renderMessages();
        return;
      }

      removeTyping();
      messages.push({ role: 'assistant', content: data.reply, ts: Date.now() });
      saveHistory();
      renderMessages();
    } catch (err) {
      removeTyping();
      const aborted = err && err.name === 'AbortError';
      messages.push({
        role: 'assistant',
        content: aborted ? 'Stopped.' : 'AI Assistant is temporarily unavailable. Please try again.',
        error: !aborted,
        ts: Date.now(),
      });
      saveHistory();
      renderMessages();
    } finally {
      activeController = null;
      setSending(false);
    }
  }

  function handleStop() {
    if (activeController) activeController.abort();
  }

  // ---- Public API ----------------------------------------------------------
  function open() {
    if (!overlayEl) {
      buildDom();
      loadHistory();
      renderMessages();
    }
    overlayEl.classList.remove('hidden');
    document.body.classList.add('ai-panel-open');
    setTimeout(() => inputEl && inputEl.focus(), 50);
  }

  function close() {
    if (overlayEl) overlayEl.classList.add('hidden');
    document.body.classList.remove('ai-panel-open');
  }

  return { open, close };
})();
