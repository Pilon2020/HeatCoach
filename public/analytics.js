/**
 * Lightweight loader that mirrors Vercel's analytics injection logic and exposes
 * `window.HCAnalytics`. This runs before the main app scripts so page views and
 * events stay consistent even though the frontend is vanilla DOM.
 */
(function () {
  if (typeof window === 'undefined') return;

  const scriptId = 'heatcoach-vercel-analytics';
  const isDevHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);

  if (!window.vaq) window.vaq = [];

  if (typeof window.va !== 'function') {
    window.va = function (...params) {
      window.vaq.push(params);
    };
  }

  function inject() {
    if (document.getElementById(scriptId)) return;
    const script = document.createElement('script');
    script.id = scriptId;
    script.defer = true;
    script.src = isDevHost ? 'https://va.vercel-scripts.com/v1/script.debug.js' : '/_vercel/insights/script.js';
    script.dataset.sdkn = '@vercel/analytics/vanilla';
    script.dataset.sdkv = '1.5.0';
    if (isDevHost) {
      script.dataset.debug = 'true';
    }
    script.onerror = () => {
      console.warn('[Analytics] Failed to load Vercel insights script. Verify your deployment supports Web Analytics.');
    };
    document.head.appendChild(script);
  }

  const analytics = {
    track(eventName, props) {
      if (!eventName || typeof window.va !== 'function') return;
      window.va('event', { name: eventName, properties: props });
    },
    pageview(path) {
      if (!path) {
        path = window.location.pathname;
      }
      this.track('pageview', { path });
    }
  };

  window.HCAnalytics = analytics;
  inject();

  window.addEventListener('load', () => {
    analytics.pageview(window.location.pathname);
  });
})();
