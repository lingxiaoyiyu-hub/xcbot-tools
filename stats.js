(function () {
  var API_BASE = '/api';

  function cleanPath() {
    var path = window.location.pathname || '/';
    path = path.replace(/\/index\.html$/i, '/');
    return path || '/';
  }

  function trackPageView() {
    if (window.__xcbotStatsTracked) return;
    window.__xcbotStatsTracked = true;

    var payload = JSON.stringify({
      type: 'page_view',
      path: cleanPath(),
      title: document.title || ''
    });
    var url = API_BASE + '/stats/track';

    try {
      if (navigator.sendBeacon) {
        var blob = new Blob([payload], { type: 'text/plain' });
        if (navigator.sendBeacon(url, blob)) return;
      }
    } catch (error) {}

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: payload,
      keepalive: true
    }).catch(function () {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', trackPageView, { once: true });
  } else {
    trackPageView();
  }
})();
