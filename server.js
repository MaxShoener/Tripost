// server.js
const express = require('express');
const got = require('got');
const cheerio = require('cheerio');
const mime = require('mime-types');
const bodyParser = require('body-parser');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

// parse urlencoded & json bodies to forward POST requests
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json({ limit: '10mb' }));

/**
 * Helper: make an absolute URL from a possibly relative one, given base
 */
function makeAbsUrl(href, base) {
  try {
    return new URL(href, base).toString();
  } catch (e) {
    return null;
  }
}

/**
 * Core proxy handler: supports GET/POST/other methods.
 * Accepts query param `u` = target url (encoded).
 */
app.all('/proxy', async (req, res) => {
  const target = req.query.u;
  if (!target) return res.status(400).send('Missing target URL parameter "u".');

  // basic safety check: require http(s)
  if (!/^https?:\/\//i.test(target)) {
    return res.status(400).send('Target must be a full URL that starts with http:// or https://');
  }

  try {
    // Build options for got: forward method and body
    const opts = {
      method: req.method,
      headers: {
        // forward select headers but avoid cookies to the client
        'user-agent': req.headers['user-agent'] || 'proxy',
        accept: req.headers.accept || '*/*',
        // you can add more forwarded headers if needed
      },
      throwHttpErrors: false,
      // if there's a body, forward it
      body: (req.method !== 'GET' && req.method !== 'HEAD') ? req.body && Object.keys(req.body).length ? JSON.stringify(req.body) : undefined : undefined,
      responseType: 'buffer',
      followRedirect: true,
      maxRedirects: 10,
      timeout: { request: 20000 }
    };

    const upstream = await got(target, opts);

    // get content-type
    const ctype = (upstream.headers['content-type'] || '').split(';')[0].trim().toLowerCase();

    // If content is HTML, rewrite links so resources go through /proxy?u=...
    if (ctype === 'text/html' || ctype === 'application/xhtml+xml') {
      const html = upstream.body.toString('utf8');
      const $ = cheerio.load(html, { decodeEntities: false });

      // Ensure base tag exists so relative URL resolution in browsers still works (but we still rewrite resources)
      const baseTag = $('base');
      if (!baseTag.length) {
        $('head').prepend(`<base href="${target}">`);
      } else {
        baseTag.attr('href', target);
      }

      // Attributes to rewrite
      const ATTRS = ['href', 'src', 'action', 'data-src', 'poster'];

      ATTRS.forEach(attr => {
        // select elements with that attribute
        $(`[${attr}]`).each((i, el) => {
          const old = $(el).attr(attr);
          if (!old || old.startsWith('data:') || old.startsWith('javascript:') || old.startsWith('#')) return;

          const absolute = makeAbsUrl(old, target);
          if (!absolute) return;

          // rewrite to go through our proxy: /proxy?u=<encoded>
          $(el).attr(attr, `/proxy?u=${encodeURIComponent(absolute)}`);
        });
      });

      // Rewrite srcset (images)
      $('[srcset]').each((i, el) => {
        const srcset = $(el).attr('srcset');
        if (!srcset) return;
        const parts = srcset.split(',').map(p => {
          const [urlPart, descriptor] = p.trim().split(/\s+/, 2);
          const abs = makeAbsUrl(urlPart, target) || urlPart;
          return `/proxy?u=${encodeURIComponent(abs)}${descriptor ? ' ' + descriptor : ''}`;
        });
        $(el).attr('srcset', parts.join(', '));
      });

      // Rewrite inline CSS url(...) in style tags and style attributes (basic)
      $('*[style]').each((i, el) => {
        let s = $(el).attr('style');
        s = s.replace(/url\((['"]?)(.+?)\1\)/g, (m, q, u) => {
          const abs = makeAbsUrl(u, target) || u;
          return `url('/proxy?u=${encodeURIComponent(abs)}')`;
        });
        $(el).attr('style', s);
      });
      $('style').each((i, el) => {
        let s = $(el).html() || '';
        s = s.replace(/url\((['"]?)(.+?)\1\)/g, (m, q, u) => {
          const abs = makeAbsUrl(u, target) || u;
          return `url('/proxy?u=${encodeURIComponent(abs)}')`;
        });
        $(el).html(s);
      });

      // Optionally inject a small banner / remove CSP that would block framing / scripts from working
      // Remove CSP headers from upstream by not forwarding them, and inject small client script to help navigation
      // Insert a small script to rewrite window.location for forms opened in new windows (optional)
      $('head').append(`<meta name="x-proxied-by" content="cloaker-proxy">`);

      // Serve rewritten HTML
      res.setHeader('content-type', 'text/html; charset=utf-8');
      // don't forward upstream security headers (Content-Security-Policy, X-Frame-Options) which would break embedding
      return res.send($.html());
    }

    // Non-HTML: pipe binary (image, css, js, etc.)
    const outType = upstream.headers['content-type'] || mime.lookup(target) || 'application/octet-stream';
    res.setHeader('content-type', outType);
    // Don't forward upstream set-cookie to avoid leaking remote cookies; you can forward selectively if needed
    // forward cache-control and other useful headers
    if (upstream.headers['cache-control']) res.setHeader('cache-control', upstream.headers['cache-control']);
    if (upstream.headers['content-length']) res.setHeader('content-length', upstream.headers['content-length']);

    return res.send(upstream.body);
  } catch (err) {
    console.error('Proxy error:', err && err.message);
    return res.status(502).send('Error fetching target: ' + (err && err.message));
  }
});

// Simple index for testing — served from /public/index.html
app.listen(PORT, () => {
  console.log(`Cloaker proxy running at http://localhost:${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser.`);
});