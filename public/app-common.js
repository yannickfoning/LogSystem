/**
 * Initialisation commune des pages authentifiées (session, navbar, i18n).
 */
(function () {
  'use strict';

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
      return u;
    }).catch(function () {
      window.location.href = '/login.html';
      return Promise.reject(new Error('Unauthorized'));
    });
  };

  document.addEventListener('DOMContentLoaded', function () {
    if (document.body.classList.contains('login-hero')) return;
    if (document.getElementById('user-info')) {
      window.initApp();
    }
  });
})();
