// Vercel Web Analytics initialization
// Documentation: https://vercel.com/docs/analytics/quickstart

// Initialize the queue for Vercel Analytics
window.va = window.va || function () { 
  (window.vaq = window.vaq || []).push(arguments); 
};

// The script will be loaded from Vercel's CDN when deployed
// In development, this won't track (which is the intended behavior)
(function() {
  const script = document.createElement('script');
  script.defer = true;
  script.src = '/_vercel/insights/script.js';
  document.head.appendChild(script);
})();
