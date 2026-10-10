/**
 * ai-assistant.js
 * ------------------------------------------------------------
 * Floating AI Assistant launcher. This file is intentionally tiny and is
 * always loaded with the rest of chat.html - it only injects a small
 * floating icon that matches the existing glass/purple design.
 *
 * The actual chat interface (markdown rendering, message history, the
 * network call to the Cloudflare Worker, etc.) lives in ai-panel.js and is
 * only fetched the first time the user taps the icon, so normal page load
 * and existing chat/socket performance are unaffected.
 * ------------------------------------------------------------
 */
(function () {
  function injectFab() {
    if (document.getElementById('aiAssistantFab')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'aiAssistantFab';
    btn.className = 'ai-fab';
    btn.title = 'AI Assistant';
    btn.setAttribute('aria-label', 'Open AI Assistant');
    btn.innerHTML = '<span class="ai-fab-icon" aria-hidden="true">🤖</span>';
    // Auto-adjust vertical position: on the chat screen there's a real
    // composer (and the sidebar's own "+" button) to clear; on login/
    // register there isn't, so it can sit lower.
    if (document.querySelector('.composer')) {
      btn.classList.add('ai-fab--chat-page');
    }
    btn.addEventListener('click', onFabClick);
    document.body.appendChild(btn);
  }

  let loadingPromise = null;
  function loadPanelScript() {
    if (window.ScsAIPanel) return Promise.resolve();
    if (loadingPromise) return loadingPromise;
    loadingPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/js/ai-panel.js?v=2';
      script.onload = () => resolve();
      script.onerror = () => {
        loadingPromise = null; // allow retry on next tap
        reject(new Error('Failed to load AI Assistant.'));
      };
      document.body.appendChild(script);
    });
    return loadingPromise;
  }

  async function onFabClick() {
    const fab = document.getElementById('aiAssistantFab');
    if (fab.classList.contains('ai-fab--loading')) return; // prevent double-tap while loading
    fab.classList.add('ai-fab--loading');
    try {
      await loadPanelScript();
      window.ScsAIPanel.open();
    } catch (e) {
      if (typeof Toast !== 'undefined' && Toast.error) {
        Toast.error('AI Assistant is temporarily unavailable. Please try again.');
      }
    } finally {
      fab.classList.remove('ai-fab--loading');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectFab);
  } else {
    injectFab();
  }
})();
