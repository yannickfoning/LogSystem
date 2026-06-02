(function () {
  'use strict';

  var form = document.getElementById('login-form');
  var emailInput = document.getElementById('email');
  var pwdInput = document.getElementById('password');
  var loginBtn = document.getElementById('login-btn');
  var errorDiv = document.getElementById('login-error');
  var closeBtn = document.getElementById('close-login');
  var loginToggleBtn = document.getElementById('login-toggle-btn');
  var loginOverlay = document.getElementById('login-overlay');
  var brandTitle = document.getElementById('brand-title');
  var langToggleBtn = document.getElementById('lang-toggle-btn');
  var langText = document.getElementById('lang-text');

  function getCsrfToken() {
    var match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  function openLoginOverlay() {
    loginOverlay.classList.add('is-open');
    brandTitle.style.opacity = '0.3';
    loginToggleBtn.style.display = 'none';
  }

  function closeLoginOverlay() {
    loginOverlay.classList.remove('is-open');
    brandTitle.style.opacity = '1';
    loginToggleBtn.style.display = 'flex';
  }

  closeBtn.addEventListener('click', closeLoginOverlay);
  loginToggleBtn.addEventListener('click', openLoginOverlay);

  loginOverlay.addEventListener('click', function (e) {
    if (e.target === loginOverlay) {
      closeLoginOverlay();
    }
  });

  langToggleBtn.addEventListener('click', function () {
    var currentLang = window.i18n && typeof window.i18n.getLang === 'function' ? window.i18n.getLang() : 'fr';
    var newLang = currentLang === 'fr' ? 'en' : 'fr';
    langText.textContent = newLang.toUpperCase();

    if (window.i18n) {
      window.i18n.setLang(newLang);
      window.i18n.applyAll();
      document.title = window.i18n.t('app.title') + ' - ' + window.i18n.t('login.title');
      var brandSubtitle = brandTitle.querySelector('p');
      if (brandSubtitle) {
        brandSubtitle.textContent = window.i18n.t('login.platform');
      }
    }
  });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    errorDiv.style.display = 'none';
    loginBtn.disabled = true;
    loginBtn.textContent = '';
    var spinner = document.createElement('span');
    spinner.className = 'spinner';
    loginBtn.appendChild(spinner);

    try {
      var resp = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': getCsrfToken()
        },
        body: JSON.stringify({
          email: emailInput.value,
          password: pwdInput.value
        })
      });

      var data = await resp.json();

      if (!resp.ok) {
        errorDiv.textContent = data.error || (window.i18n ? window.i18n.t('login.error.invalid') : 'Identifiants invalides');
        errorDiv.style.display = 'block';
        return;
      }

      window.location.href = data.role === 'admin' ? '/admin.html' : '/dashboard.html';
    } catch (err) {
      errorDiv.textContent = window.i18n ? window.i18n.t('login.error.network') : 'Erreur réseau. Vérifiez votre connexion.';
      errorDiv.style.display = 'block';
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = window.i18n ? window.i18n.t('login.btn') : 'Se connecter';
    }
  });
})();
