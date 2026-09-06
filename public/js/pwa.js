/**
 * pwa.js - Service worker registration + "Install App" prompt.
 * Purely additive: does not touch auth, sockets, or any existing app logic.
 * Safe to include on every page (index/chat/admin).
 */
(function () {
  const DISMISS_KEY = 'scs_pwa_install_dismissed_at';
  const DISMISS_DAYS = 7;

  // ---- Service worker registration -----------------------------------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* non-fatal: app works fine without offline support */
      });
    });
  }

  // ---- Helpers ----------------------------------------------------------
  function isStandalone() {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true // iOS Safari
    );
  }

  function isDismissedRecently() {
    const ts = Number(localStorage.getItem(DISMISS_KEY) || 0);
    if (!ts) return false;
    const days = (Date.now() - ts) / (1000 * 60 * 60 * 24);
    return days < DISMISS_DAYS;
  }

  function markDismissed() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  }

  function isIos() {
    return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  }

  // ---- Banner UI ----------------------------------------------------------
  let bannerEl = null;

  function removeBanner() {
    if (bannerEl) {
      bannerEl.remove();
      bannerEl = null;
    }
  }

  function showBanner({ subtitle, primaryLabel, onPrimary }) {
    if (isStandalone() || isDismissedRecently() || bannerEl) return;

    bannerEl = document.createElement('div');
    bannerEl.className = 'pwa-install-banner glass';
    bannerEl.innerHTML = `
      <div class="pwa-icon">💕</div>
      <div class="pwa-text">
        <div class="pwa-title">Install Cute</div>
        <div class="pwa-subtitle">${subtitle}</div>
      </div>
      <div class="pwa-actions">
        <button type="button" class="btn btn-primary pwa-install-go">${primaryLabel}</button>
        <button type="button" class="pwa-close" title="Not now">✕</button>
      </div>
    `;
    document.body.appendChild(bannerEl);

    bannerEl.querySelector('.pwa-install-go').addEventListener('click', async () => {
      await onPrimary();
    });
    bannerEl.querySelector('.pwa-close').addEventListener('click', () => {
      markDismissed();
      removeBanner();
    });
  }

  // ---- Android / desktop Chrome-style install ----------------------------
  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showInstallButtonIfPresent();

    // Give the user a moment to look around before offering the banner.
    setTimeout(() => {
      showBanner({
        subtitle: 'Add it to your home screen for a faster, full-screen experience.',
        primaryLabel: 'Install',
        onPrimary: async () => {
          removeBanner();
          if (!deferredPrompt) return;
          deferredPrompt.prompt();
          const { outcome } = await deferredPrompt.userChoice;
          if (outcome === 'accepted') {
            Toast?.success?.('Installing Cute…');
          }
          deferredPrompt = null;
          hideInstallButtonIfPresent();
        },
      });
    }, 2500);
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    removeBanner();
    hideInstallButtonIfPresent();
    Toast?.success?.('Cute installed!');
  });

  // ---- iOS Safari (no beforeinstallprompt support) -----------------------
  if (isIos() && !isStandalone()) {
    setTimeout(() => {
      showBanner({
        subtitle: 'Tap Share, then "Add to Home Screen".',
        primaryLabel: 'Got it',
        onPrimary: async () => {
          markDismissed();
          removeBanner();
        },
      });
    }, 3000);
  }

  // ---- Optional manual trigger button (e.g. in a header/menu) ------------
  // Any element with [data-pwa-install] will trigger the native prompt on
  // click when available, and stays hidden otherwise.
  function showInstallButtonIfPresent() {
    document.querySelectorAll('[data-pwa-install]').forEach((el) => {
      el.classList.remove('hidden');
      el.style.display = '';
    });
  }
  function hideInstallButtonIfPresent() {
    document.querySelectorAll('[data-pwa-install]').forEach((el) => {
      el.classList.add('hidden');
    });
  }
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-pwa-install]').forEach((el) => {
      el.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
        hideInstallButtonIfPresent();
      });
    });
  });
})();
