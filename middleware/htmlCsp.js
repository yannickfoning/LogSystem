import fs from 'fs';
import path from 'path';

/**
 * Injecte le nonce CSP dans les balises <style> et <script> inline des pages HTML statiques.
 */
export function injectHtmlNonce(html, nonce) {
  if (!nonce) return html;
  return html
    .replace(/<style\b(?![^>]*\bnonce=)/gi, `<style nonce="${nonce}"`)
    .replace(/<script\b(?![^>]*\bsrc=)(?![^>]*\bnonce=)/gi, `<script nonce="${nonce}"`);
}

/**
 * Middleware Express : sert les .html avec nonce injecté (compatible Helmet CSP).
 */
export function createHtmlCspMiddleware(publicDir) {
  const root = path.resolve(publicDir);

  return function htmlCspMiddleware(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (!req.path.endsWith('.html')) return next();

    const safePath = path.normalize(req.path).replace(/^(\.\.(\/|\\|$))+/, '');
    const filePath = path.join(root, safePath);

    if (!filePath.startsWith(root) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return next();
    }

    if (req.method === 'HEAD') {
      res.type('html');
      return res.end();
    }

    try {
      const html = fs.readFileSync(filePath, 'utf8');
      const nonce = res.locals.cspNonce || '';
      res.type('html').send(injectHtmlNonce(html, nonce));
    } catch (err) {
      next(err);
    }
  };
}
