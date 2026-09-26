/**
 * Cluster Auto-Advance
 * If the user remains on the blog article details page at the same place
 * for more than 4-5 seconds without scrolling to read, automatically open
 * another article from the same topic cluster.
 */
(function () {
  'use strict';

  // Only run on article detail pages (inside /education/ or /news/, not indexes)
  var path = window.location.pathname;
  if (!path.includes('/education/') && !path.includes('/news/')) return;
  if (path.endsWith('/education/') || path.endsWith('/news/') || path.endsWith('index.html')) return;

  function initClusterAutoAdvance() {
    var currentPath = window.location.pathname.replace(/\/$/, '');
    var candidates = [];

    // 1. Prioritize sibling cluster links
    document.querySelectorAll('.topic-cluster-list a').forEach(function (a) {
      if (a.href && !a.href.includes(currentPath) && candidates.indexOf(a.href) === -1) {
        candidates.push(a.href);
      }
    });

    // 2. Check cluster pillar guide link
    document.querySelectorAll('.topic-cluster-pillar-lead h4 a, .topic-cluster-pillar-lead h3 a').forEach(function (a) {
      if (a.href && !a.href.includes(currentPath) && candidates.indexOf(a.href) === -1) {
        candidates.push(a.href);
      }
    });

    // 3. Fallback: Related / recommendation links
    document.querySelectorAll('.recommendations-grid a.recommendation-card, .related-articles-grid a').forEach(function (a) {
      if (a.href && !a.href.includes(currentPath) && candidates.indexOf(a.href) === -1) {
        candidates.push(a.href);
      }
    });

    if (candidates.length === 0) return;

    // Pick target: next cluster article
    var targetUrl = candidates[0];

    var banner = null;
    var autoAdvanceTimer = null;
    var countdownInterval = null;
    var isCancelled = false;

    function createBanner() {
      if (banner) return banner;
      banner = document.createElement('div');
      banner.id = 'cluster-auto-advance-banner';
      banner.setAttribute('role', 'alert');
      banner.setAttribute('aria-live', 'polite');
      banner.innerHTML = [
        '<div style="',
        '  position: fixed; bottom: 22px; right: 22px; max-width: 370px;',
        '  background: #10131c; border: 1px solid #4f79ff; box-shadow: 0 12px 36px rgba(0,0,0,0.65);',
        '  border-radius: 10px; padding: 14px 16px; color: #e2e5f0;',
        '  font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; font-size: 13px;',
        '  z-index: 999999; display: flex; flex-direction: column; gap: 10px;',
        '">',
        '  <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">',
        '    <div style="font-weight:700;color:#fff;display:flex;align-items:center;gap:6px;">',
        '      <span>📚 Topic Cluster Navigation</span>',
        '    </div>',
        '    <button id="cluster-cancel-btn" style="background:none;border:none;color:#8590b0;cursor:pointer;font-size:16px;line-height:1;padding:0 4px;" title="Stay on this page">✕</button>',
        '  </div>',
        '  <div style="color:#a6b0cf;line-height:1.45;">',
        '    Inactive for 5s — auto-opening next article in this cluster in <strong id="cluster-countdown" style="color:#4f79ff;">2s</strong>...',
        '  </div>',
        '  <div style="display:flex;gap:8px;align-items:center;">',
        '    <button id="cluster-now-btn" style="background:#4f79ff;border:none;color:#fff;border-radius:6px;padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer;">Open now →</button>',
        '    <button id="cluster-stay-btn" style="background:#161a27;border:1px solid #2a3148;color:#e2e5f0;border-radius:6px;padding:6px 12px;font-size:12px;font-weight:500;cursor:pointer;">Stay here</button>',
        '  </div>',
        '</div>'
      ].join('');
      document.body.appendChild(banner);

      document.getElementById('cluster-cancel-btn').addEventListener('click', cancelAutoAdvance);
      document.getElementById('cluster-stay-btn').addEventListener('click', cancelAutoAdvance);
      document.getElementById('cluster-now-btn').addEventListener('click', function () {
        window.location.href = targetUrl;
      });

      return banner;
    }

    function cancelAutoAdvance() {
      isCancelled = true;
      clearTimeout(autoAdvanceTimer);
      clearInterval(countdownInterval);
      if (banner && banner.parentNode) {
        banner.parentNode.removeChild(banner);
        banner = null;
      }
    }

    function triggerAutoAdvanceNotice() {
      if (isCancelled) return;
      createBanner();
      var timeLeft = 2;
      var countEl = document.getElementById('cluster-countdown');

      countdownInterval = setInterval(function () {
        timeLeft--;
        if (countEl) countEl.textContent = timeLeft + 's';
        if (timeLeft <= 0) {
          clearInterval(countdownInterval);
          window.location.href = targetUrl;
        }
      }, 1000);
    }

    // 4.5 seconds idle detection without scrolling/moving
    function resetTimer() {
      if (isCancelled) return;
      clearTimeout(autoAdvanceTimer);
      clearInterval(countdownInterval);
      if (banner && banner.parentNode) {
        banner.parentNode.removeChild(banner);
        banner = null;
      }
      autoAdvanceTimer = setTimeout(triggerAutoAdvanceNotice, 4500);
    }

    // If user is actively reading/scrolling/interacting, reset idle timer
    ['scroll', 'wheel', 'touchmove', 'mousemove', 'keydown'].forEach(function (ev) {
      window.addEventListener(ev, resetTimer, { passive: true });
    });

    // Start initial timer
    autoAdvanceTimer = setTimeout(triggerAutoAdvanceNotice, 4500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initClusterAutoAdvance);
  } else {
    initClusterAutoAdvance();
  }
})();
