/**
 * LogSystem v6 — Mobile navigation (hamburger drawer + bottom nav)
 */
(function () {
  'use strict';

  var NAV_ITEMS = [
    { href: '/dashboard.html', label: 'Tableau de bord', icon: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z' },
    { href: '/search.html', label: 'Recherche', icon: 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C8.01 14 6 11.99 6 9.5S8.01 5 10.5 5 15 7.01 15 9.5 12.99 14 10.5 14z' },
    { href: '/import.html', label: 'Import', icon: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z' },
    { href: '/watchlog.html', label: 'Watch', icon: 'M4 10v4h16v-4H4zm0-6v4h10V4H4zm0 12v4h10v-4H4z' },
    { href: '/admin.html', label: 'Admin', icon: 'M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z', adminOnly: true }
  ];

  function svgIcon(pathD) {
    return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="' + pathD + '"/></svg>';
  }

  function buildBottomNav() {
    if (document.querySelector('.bottom-nav')) return;
    var nav = document.createElement('nav');
    nav.className = 'bottom-nav';
    nav.setAttribute('aria-label', 'Navigation mobile');
    var path = window.location.pathname;
    NAV_ITEMS.forEach(function (item) {
      var a = document.createElement('a');
      a.href = item.href;
      a.innerHTML = svgIcon(item.icon) + '<span>' + item.label + '</span>';
      if (item.href === path || path.endsWith(item.href.replace(/^\//, ''))) {
        a.setAttribute('aria-current', 'page');
        a.classList.add('active');
      }
      if (item.adminOnly) {
        a.id = 'bottom-admin-link';
      }
      nav.appendChild(a);
    });
    document.body.appendChild(nav);
    document.body.classList.add('has-bottom-nav');
  }

  function initHamburger() {
    var btn = document.getElementById('hamburger-btn');
    var nav = document.getElementById('nav-links');
    if (!btn || !nav) return;

    var overlay = document.createElement('div');
    overlay.className = 'nav-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    document.body.appendChild(overlay);

    function closeNav() {
      nav.classList.remove('open');
      btn.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
      overlay.classList.remove('visible');
    }

    function openNav() {
      nav.classList.add('open');
      btn.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      overlay.classList.add('visible');
    }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (nav.classList.contains('open')) closeNav();
      else openNav();
    });

    overlay.addEventListener('click', closeNav);

    document.addEventListener('click', function (e) {
      if (!btn.contains(e.target) && !nav.contains(e.target)) closeNav();
    });

    nav.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', closeNav);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeNav();
    });
  }

  function hideAdminForNonAdmins() {
    var hide = function () {
      if (window.currentUser && window.currentUser.role !== 'admin') {
        var link = document.getElementById('bottom-admin-link');
        if (link) link.style.display = 'none';
      }
    };
    if (window.currentUser) hide();
    else document.addEventListener('app:ready', hide);
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (document.body.classList.contains('login-hero')) return;
    buildBottomNav();
    initHamburger();
    hideAdminForNonAdmins();
  });
})();
