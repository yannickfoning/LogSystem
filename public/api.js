(function() {
  'use strict';

  function getCSRF() {
    const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  function apiFetch(url, opts) {
    opts = opts || {};
    const method = (opts.method || 'GET').toUpperCase();
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
      opts.headers = opts.headers || {};
      opts.headers['X-CSRF-Token'] = getCSRF();
    }
    if (!opts.headers || !opts.headers['Content-Type']) {
      if (opts.body && typeof opts.body === 'string') {
        opts.headers = opts.headers || {};
        opts.headers['Content-Type'] = 'application/json';
      }
    }
    opts.credentials = opts.credentials || 'same-origin';
    return fetch(url, opts).then(function(resp) {
      if (resp.status === 401) {
        window.location.href = '/login.html';
        return Promise.reject(new Error('Unauthorized'));
      }
      if (!resp.ok) {
        return resp.json().then(function(d) {
          return Promise.reject(d && d.error ? d : { error: resp.statusText || 'Erreur serveur' });
        }).catch(function() {
          return Promise.reject({ error: resp.statusText || 'Erreur serveur' });
        });
      }
      var ct = resp.headers.get('content-type') || '';
      if (ct.includes('application/json')) return resp.json();
      return resp.text();
    });
  }

  var api = {
    get: function(url) { return apiFetch(url); },
    post: function(url, data) {
      return apiFetch(url, { method: 'POST', body: JSON.stringify(data !== undefined ? data : {}) });
    },
    put: function(url, data) {
      return apiFetch(url, { method: 'PUT', body: JSON.stringify(data !== undefined ? data : {}) });
    },
    del: function(url) {
      return apiFetch(url, { method: 'DELETE' });
    },
    delete: function(url) {
      return apiFetch(url, { method: 'DELETE' });
    },
    patch: function(url, data) {
      return apiFetch(url, { method: 'PATCH', body: JSON.stringify(data !== undefined ? data : {}) });
    },
    upload: function(url, formData) {
      return new Promise(function(resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        xhr.setRequestHeader('X-CSRF-Token', getCSRF());
        xhr.timeout = 0;
        xhr.withCredentials = true;
        xhr.onload = function() {
          if (xhr.status === 401) { window.location.href = '/login.html'; return; }
          try { var d = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300) resolve(d);
            else reject(d && d.error ? d : { error: xhr.statusText });
          } catch(_e) { reject({ error: xhr.statusText }); }
        };
        xhr.onerror = function() { reject({ error: 'Erreur r�seau' }); };
        xhr.send(formData);
      });
    }
  };

  function fmtDT(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    try {
      return d.toLocaleString('fr-FR', {
        timeZone: 'Africa/Douala',
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    } catch (_e) {
      return d.toLocaleString('fr-FR');
    }
  }

  function fmtRel(iso) {
    if (!iso) return '-';
    var now = Date.now();
    var then = new Date(iso).getTime();
    var diff = Math.floor((now - then) / 1000);
    if (diff < 10) return "À l'instant";
    if (diff < 60) return 'Il y a ' + diff + 's';
    if (diff < 3600) return 'Il y a ' + Math.floor(diff / 60) + ' min';
    if (diff < 86400) return 'Il y a ' + Math.floor(diff / 3600) + 'h';
    if (diff < 604800) return 'Il y a ' + Math.floor(diff / 86400) + 'j';
    return fmtDT(iso);
  }

  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escAttr(str) {
    return esc(str)
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function badge(level) {
    if (!level) return '';
    var cls = 'badge badge-' + level.toLowerCase();
    return '<span class="' + cls + '">' + esc(level) + '</span>';
  }

  function badgeStatus(status) {
    if (!status) return '';
    var cls = 'badge badge-status-' + status.toLowerCase();
    return '<span class="' + cls + '">' + esc(status) + '</span>';
  }

  function toast() {
    this._container = document.querySelector('.toast-container');
    if (!this._container) {
      this._container = document.createElement('div');
      this._container.className = 'toast-container';
      document.body.appendChild(this._container);
    }
  }

  toast.prototype._add = function(message, type) {
    var t = document.createElement('div');
    t.className = 'toast toast-' + type;
    t.textContent = message;
    this._container.appendChild(t);
    setTimeout(function() {
      t.style.opacity = '0';
      t.style.transform = 'translateX(100%)';
      t.style.transition = 'all 0.3s';
      setTimeout(function() { t.remove(); }, 300);
    }, 4000);
  };

  toast.prototype.success = function(msg) { this._add(msg, 'success'); };
  toast.prototype.error = function(msg) { this._add(msg, 'error'); };
  toast.prototype.warning = function(msg) { this._add(msg, 'warning'); };
  toast.prototype.info = function(msg) { this._add(msg, 'info'); };

  function paginationHtml(current, total, _cb) {
    if (total <= 1) return '';
    var pages = [];
    var start = Math.max(1, current - 2);
    var end = Math.min(total, current + 2);

    if (start > 1) pages.push(1);
    if (start > 2) pages.push('...');
    for (var i = start; i <= end; i++) pages.push(i);
    if (end < total - 1) pages.push('...');
    if (end < total) pages.push(total);

    var html = '<div class="pagination">';
    html += '<button data-page="' + (current - 1) + '" ' + (current <= 1 ? 'disabled' : '') + '>&laquo;</button>';
    for (var j = 0; j < pages.length; j++) {
      if (pages[j] === '...') {
        html += '<button disabled>...</button>';
      } else {
        html += '<button data-page="' + pages[j] + '" class="' + (pages[j] === current ? 'active' : '') + '">' + pages[j] + '</button>';
      }
    }
    html += '<button data-page="' + (current + 1) + '" ' + (current >= total ? 'disabled' : '') + '>&raquo;</button>';
    html += '</div>';
    return html;
  }

  document.addEventListener('click', function(e) {
    var btn = e.target.closest('.pagination button[data-page]');
    if (btn && !btn.disabled) {
      var page = parseInt(btn.getAttribute('data-page'));
      if (page && typeof loadPage === 'function') {
        loadPage(page);
      }
    }
  });

  var _toast = new toast();

  window.api = api;
  window.toast = _toast;
  window.fmtDT = fmtDT;
  window.fmtRel = fmtRel;
  window.esc = esc;
  window.escAttr = escAttr;
  window.paginationHtml = paginationHtml;
  window.badge = badge;
  window.badgeStatus = badgeStatus;

  /** Déconnexion centralisée (CSRF + redirection login) */
  window.logout = function() {
    return api.post('/api/auth/logout', {}).then(function() {
      window.location.href = '/login.html';
    }).catch(function() {
      window.location.href = '/login.html';
    });
  };
})();
