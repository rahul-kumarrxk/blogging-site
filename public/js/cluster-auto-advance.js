/**
 * Cluster Auto-Advance Engine
 * Automatically opens the next article in the topic cluster if the user
 * remains on the article details page at the same scroll position for 4-5 seconds
 * without scrolling.
 */
(function () {
  'use strict';

  // Only run on article detail pages (inside /education/ or /news/)
  var path = window.location.pathname;
  if (!path.includes('/education/') && !path.includes('/news/')) return;
  if (path.endsWith('/education/') || path.endsWith('/news/') || path.endsWith('index.html')) return;

  var IDLE_TRIGGER_MS = 4000;   // 4 seconds of scroll inactivity
  var TRANSITION_DELAY_MS = 1200; // 1.2 second visual cue before redirect (total ~5s)
  var isCancelled = false;
  var isNavigating = false;
  var idleTimer = null;
  var transitionTimer = null;
  var lastScrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
  var targetUrl = null;
  var targetTitle = 'Next Clustered Article';
  var bannerEl = null;

  // Extract clean slug from current URL
  var pathParts = path.replace(/\/$/, '').split('/');
  var currentFile = pathParts[pathParts.length - 1];
  var currentSlug = currentFile.replace(/\.html$/, '');

  function cleanPath(urlStr) {
    try {
      var a = document.createElement('a');
      a.href = urlStr;
      return a.pathname.replace(/\/$/, '').replace(/\.html$/, '');
    } catch (e) {
      return urlStr;
    }
  }

  // 1. Determine next cluster article
  function resolveTargetArticle(posts) {
    if (!Array.isArray(posts) || !posts.length) return fallbackToDomLinks();

    var currentPost = null;
    for (var i = 0; i < posts.length; i++) {
      if (posts[i].slug === currentSlug) {
        currentPost = posts[i];
        break;
      }
    }

    if (!currentPost || !currentPost.cluster) {
      return fallbackToDomLinks();
    }

    var clusterId = currentPost.cluster;
    // Find all other posts in the exact same cluster
    var clusterPosts = posts.filter(function (p) {
      return p.cluster === clusterId && p.slug !== currentSlug;
    });

    if (!clusterPosts.length) {
      // Fallback to other posts if no sibling in cluster
      clusterPosts = posts.filter(function (p) {
        return p.slug !== currentSlug;
      });
    }

    if (!clusterPosts.length) return fallbackToDomLinks();

    // Prefer posts not recently visited in this session
    var visited = [];
    try {
      visited = JSON.parse(sessionStorage.getItem('daybook_visited_slugs') || '[]');
    } catch (e) {}

    var unvisited = clusterPosts.filter(function (p) {
      return visited.indexOf(p.slug) === -1;
    });

    var chosen = (unvisited.length ? unvisited[0] : clusterPosts[0]);

    // Format target URL properly for both web servers and local file:// previews
    if (window.location.protocol === 'file:') {
      var currentCat = path.includes('/education/') ? 'education' : 'news';
      if (currentCat === chosen.category) {
        targetUrl = chosen.slug + '.html';
      } else {
        targetUrl = '../' + chosen.category + '/' + chosen.slug + '.html';
      }
    } else {
      targetUrl = '/' + chosen.category + '/' + chosen.slug + '.html';
    }

    targetTitle = chosen.title;
    console.log('[Cluster Auto-Advance] Next story resolved:', targetTitle, '->', targetUrl);
    startIdleTracking();
  }

  // Fallback if posts.json is unavailable
  function fallbackToDomLinks() {
    var thisPathClean = cleanPath(window.location.href);
    var candidateLinks = [];

    // Sibling cluster links in sidebar/cluster box
    document.querySelectorAll('.topic-cluster-list a, .topic-cluster-pillar-lead h4 a, .topic-cluster-pillar-lead h3 a').forEach(function (a) {
      if (a.href && cleanPath(a.href) !== thisPathClean && candidateLinks.indexOf(a.href) === -1) {
        candidateLinks.push(a);
      }
    });

    // Recommendation links
    if (!candidateLinks.length) {
      document.querySelectorAll('.recommendations-grid a.recommendation-card, .related-articles-grid a').forEach(function (a) {
        if (a.href && cleanPath(a.href) !== thisPathClean && candidateLinks.indexOf(a.href) === -1) {
          candidateLinks.push(a);
        }
      });
    }

    if (candidateLinks.length) {
      targetUrl = candidateLinks[0].href;
      targetTitle = candidateLinks[0].textContent.trim() || 'Next Clustered Article';
      console.log('[Cluster Auto-Advance] DOM fallback resolved:', targetTitle, '->', targetUrl);
      startIdleTracking();
    } else {
      console.log('[Cluster Auto-Advance] No sibling cluster links found on this page.');
    }
  }

  // 2. Auto-Navigation & Visual Notification Banner
  function triggerAutoOpen() {
    if (isCancelled || isNavigating || !targetUrl) return;

    if (!bannerEl) {
      bannerEl = document.createElement('div');
      bannerEl.id = 'cluster-auto-advance-bar';
      bannerEl.innerHTML = [
        '<div style="',
        '  position: fixed; bottom: 24px; right: 24px; max-width: 400px; width: calc(100% - 48px);',
        '  background: #111420; border: 1.5px solid #4f79ff; border-radius: 12px;',
        '  box-shadow: 0 16px 48px rgba(0,0,0,0.8); padding: 16px 18px;',
        '  color: #e2e5f0; font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif;',
        '  font-size: 13px; z-index: 999999; display: flex; flex-direction: column; gap: 10px;',
        '  animation: clusterSlideIn .25s ease-out;',
        '">',
        '  <style>',
        '    @keyframes clusterSlideIn { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }',
        '    @keyframes clusterProgress { from { width: 0%; } to { width: 100%; } }',
        '  </style>',
        '  <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">',
        '    <div style="font-weight:700;color:#fff;display:flex;align-items:center;gap:6px;font-size:13px;">',
        '      <span>📚 Auto-Opening Next Clustered Story...</span>',
        '    </div>',
        '    <button id="cluster-stay-btn" style="background:#1d2233;border:1px solid #333d59;color:#b2bada;border-radius:6px;padding:3px 10px;font-size:12px;font-weight:600;cursor:pointer;">Stay Here</button>',
        '  </div>',
        '  <div style="color:#b2bada;line-height:1.45;font-size:12.5px;">',
        '    <strong style="color:#fff;font-size:13.5px;display:block;margin-bottom:2px;">' + escapeHtml(targetTitle) + '</strong>',
        '    <span>Inactivity detected. Opening automatically...</span>',
        '  </div>',
        '  <div style="width:100%;background:#1d2233;height:4px;border-radius:2px;overflow:hidden;margin-top:2px;">',
        '    <div style="height:100%;background:#4f79ff;animation:clusterProgress ' + (TRANSITION_DELAY_MS / 1000) + 's linear forwards;"></div>',
        '  </div>',
        '</div>'
      ].join('');
      document.body.appendChild(bannerEl);

      document.getElementById('cluster-stay-btn').addEventListener('click', cancelAutoAdvance);
    }

    transitionTimer = setTimeout(function () {
      navigateNow();
    }, TRANSITION_DELAY_MS);
  }

  function navigateNow() {
    if (isCancelled || isNavigating || !targetUrl) return;
    isNavigating = true;

    // Track visited in session to cycle across all cluster stories
    try {
      var visited = JSON.parse(sessionStorage.getItem('daybook_visited_slugs') || '[]');
      if (visited.indexOf(currentSlug) === -1) visited.push(currentSlug);
      sessionStorage.setItem('daybook_visited_slugs', JSON.stringify(visited));
    } catch (e) {}

    console.log('[Cluster Auto-Advance] Redirecting now to:', targetUrl);
    window.location.href = targetUrl;
  }

  function cancelAutoAdvance() {
    console.log('[Cluster Auto-Advance] Cancelled by user.');
    isCancelled = true;
    clearTimeout(idleTimer);
    clearTimeout(transitionTimer);
    if (bannerEl && bannerEl.parentNode) {
      bannerEl.parentNode.removeChild(bannerEl);
      bannerEl = null;
    }
  }

  function resetIdleTimer() {
    if (isCancelled || isNavigating) return;
    clearTimeout(idleTimer);
    clearTimeout(transitionTimer);
    if (bannerEl && bannerEl.parentNode) {
      bannerEl.parentNode.removeChild(bannerEl);
      bannerEl = null;
    }
    idleTimer = setTimeout(triggerAutoOpen, IDLE_TRIGGER_MS);
  }

  // 3. Scroll Activity Detection
  // ONLY real scroll movements reset the idle timer — not mouse jitter!
  function onScrollActivity() {
    var newScrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
    if (Math.abs(newScrollY - lastScrollY) > 20) {
      lastScrollY = newScrollY;
      resetIdleTimer();
    }
  }

  function startIdleTracking() {
    lastScrollY = window.pageYOffset || document.documentElement.scrollTop || 0;

    // Listen only to scroll events
    window.addEventListener('scroll', onScrollActivity, { passive: true });
    window.addEventListener('wheel', onScrollActivity, { passive: true });
    window.addEventListener('touchmove', onScrollActivity, { passive: true });

    // Begin idle count
    console.log('[Cluster Auto-Advance] Tracking started. Idle trigger in ' + (IDLE_TRIGGER_MS / 1000) + 's.');
    idleTimer = setTimeout(triggerAutoOpen, IDLE_TRIGGER_MS);
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Boot: try fetch /posts.json, then ../posts.json, then fallbackToDomLinks
  function boot() {
    fetch('/posts.json')
      .then(function (r) {
        if (!r.ok) throw new Error('status ' + r.status);
        return r.json();
      })
      .then(function (posts) {
        resolveTargetArticle(posts);
      })
      .catch(function () {
        // Retry relative path
        fetch('../posts.json')
          .then(function (r) {
            if (!r.ok) throw new Error('status ' + r.status);
            return r.json();
          })
          .then(function (posts) {
            resolveTargetArticle(posts);
          })
          .catch(function () {
            fallbackToDomLinks();
          });
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
