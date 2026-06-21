/**
 * Initialisation commune des pages authentifiées (session, navbar, i18n, icônes SVG).
 */
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function svgIcon(pathD, viewBox) {
    viewBox = viewBox || '0 0 24 24';
    return '<svg xmlns="' + SVG_NS + '" viewBox="' + viewBox + '" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="' + pathD + '"/></svg>';
  }

  window.icons = {
    eye: svgIcon('M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z'),
    pause: svgIcon('M6 19h4V5H6v14zm8-14v14h4V5h-4z'),
    play: svgIcon('M8 5v14l11-7z'),
    trash: svgIcon('M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z'),
    download: svgIcon('M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z'),
    times: svgIcon('M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'),
    bell: svgIcon('M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z'),
    chartBar: svgIcon('M5 9.2h3V19H5V9.2zM10.6 5h2.8v14h-2.8V5zm5.6 8H19v6h-2.8v-6z'),
    chartLine: svgIcon('M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z'),
    cogs: svgIcon('M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z'),
    stream: svgIcon('M4 10v4h16v-4H4zm0-6v4h10V4H4zm0 12v4h10v-4H4z'),
    fire: svgIcon('M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73 0-2.15.74-4.8.74-4.8S6.5 4.5 6.5 7.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5c0-3-2.5-6.83-2.5-6.83zM12 22c-3.31 0-6-2.69-6-6 0-2.25 1.25-4.21 3.09-5.23.35-.19.79-.06.98.29.19.35.06.79-.29.98C8.96 13.04 8 14.42 8 16c0 2.21 1.79 4 4 4s4-1.79 4-4c0-1.58-.96-2.96-2.78-3.96-.35-.19-.48-.63-.29-.98.19-.35.63-.48.98-.29C16.75 11.79 18 13.75 18 16c0 3.31-2.69 6-6 6z'),
    exclamationTriangle: svgIcon('M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z')
  };

  window.iconHtml = function (name) {
    return window.icons[name] || '';
  };

  window.escapeHtml = function (s) {
    var d = document.createElement('div');
    d.textContent = String(s == null ? '' : s);
    return d.innerHTML;
  };

  /** Format log event timestamp (prefers event_timestamp over timestamp). */
  window.logEventTime = function (log) {
    return log && (log.event_timestamp || log.timestamp) || null;
  };

  /** Render standardized log metadata block for detail modals. */
  window.renderLogDetailHtml = function (log, esc, fmtDT, badge) {
    if (!log) return '';
    var eventTs = window.logEventTime(log);
    var html = '<div style="font-size:13px;line-height:1.8">';
    html += '<p><strong>Identifiant:</strong> ' + log.id + '</p>';
    html += '<p><strong>Date du log:</strong> ' + fmtDT(eventTs);
    if (log.timestamp_inferred) {
      html += ' <span title="Date inférée lors de l\'import" style="background:#fef3c7;color:#92400e;padding:2px 7px;border-radius:4px;font-size:11px;margin-left:6px">⚠ date inférée</span>';
    }
    html += '</p>';
    if (log.imported_at) html += '<p><strong>Date d\'import:</strong> ' + fmtDT(log.imported_at) + '</p>';
    html += '<p><strong>Niveau:</strong> ' + badge(log.log_level) + '</p>';
    html += '<p><strong>Source:</strong> ' + esc(log.source_system || log.log_source || log.source || '—') + '</p>';
    html += '<p><strong>Service principal:</strong> ' + esc(log.main_service || '—') + '</p>';
    html += '<p><strong>Hôte:</strong> ' + esc(log.hostname || log.source_server || '—') + '</p>';
    html += '<p><strong>Service:</strong> ' + esc(log.service || '—') + '</p>';
    html += '<p><strong>Utilisateur:</strong> ' + esc(log.log_user || log.target_user || '—') + '</p>';
    if (log.log_origin) html += '<p><strong>Origine:</strong> ' + esc(log.log_origin) + '</p>';
    html += '<hr style="border-color:var(--border);margin:12px 0">';
    html += '<p><strong>Message:</strong></p><pre style="background:var(--surface2);padding:12px;border-radius:8px;white-space:pre-wrap;word-break:break-all;font-size:12px;max-height:200px;overflow:auto">' + esc(log.message) + '</pre>';
    if (log.stack_trace) {
      html += '<p style="margin-top:8px"><strong>Stack trace:</strong></p><pre style="background:#1a0000;color:#ff6b6b;padding:12px;border-radius:8px;white-space:pre-wrap;word-break:break-all;font-size:11px;max-height:200px;overflow:auto">' + esc(log.stack_trace) + '</pre>';
    }
    if (log.file_name) html += '<p><strong>Fichier:</strong> ' + esc(log.file_name) + '</p>';
    if (log.import_job_id) html += '<p><strong>Job import:</strong> #' + esc(log.import_job_id) + '</p>';
    html += '</div>';
    return html;
  };

  function markActiveNav() {
    var path = window.location.pathname;
    document.querySelectorAll('.nav-links a[href]').forEach(function (a) {
      var href = a.getAttribute('href');
      var active = href === path || (path.endsWith(href.replace(/^\//, '')));
      if (active) {
        a.setAttribute('aria-current', 'page');
        a.classList.add('active');
      } else {
        a.removeAttribute('aria-current');
        a.classList.remove('active');
      }
    });
  }

  if (!window.api) return;

  window.initApp = function () {
    return api.get('/api/auth/me').then(function (u) {
      window.currentUser = u;
      var info = document.getElementById('user-info');
      if (info) info.textContent = u.display_name || u.email;

      var adminLink = document.getElementById('admin-link');
      if (adminLink && u.role !== 'admin') {
        adminLink.style.display = 'none';
      }

      if (window.i18n) {
        window.i18n.refreshPage();
        window.i18n.mountToggle('lang-toggle');
      }
      markActiveNav();
      document.dispatchEvent(new CustomEvent('app:ready', { detail: u }));
      return u;
    }).catch(function () {
      window.location.href = '/login.html';
      return Promise.reject(new Error('Unauthorized'));
    });
  };

  document.addEventListener('DOMContentLoaded', function () {
    if (document.body.classList.contains('login-hero')) return;
    markActiveNav();
    if (document.getElementById('user-info')) {
      window.initApp();
    }
  });
})();
