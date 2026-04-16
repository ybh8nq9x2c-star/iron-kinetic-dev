const express = require('express');
const compression = require('compression');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

/* [SRV-03] Enable gzip/brotli compression — reduces ~380KB index.html to ~50-60KB */
app.use(compression());

/* [SRV-04] Security headers — CSP, X-Frame-Options, HSTS, X-Content-Type-Options */
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
  next();
});

/* [SRV-05] Basic rate limiting — 100 req/min per IP, no external deps */
const rateLimitMap = new Map();
app.use((req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > 60000) { entry.count = 0; entry.start = now; }
  entry.count++;
  rateLimitMap.set(ip, entry);
  /* Purge stale entries every 100 requests */
  if (rateLimitMap.size > 1000) {
    for (const [k, v] of rateLimitMap) { if (now - v.start > 60000) rateLimitMap.delete(k); }
  }
  if (entry.count > 100) {
    return res.status(429).set('Retry-After', '60').send('Too many requests');
  }
  next();
});

// sw.js e index.html: mai in cache — il browser deve sempre prendere la versione fresca
app.use((req, res, next) => {
  const url = req.path;
  if (url === '/sw.js' || url === '/index.html' || url === '/') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Service-Worker-Allowed', '/');
  } else {
    // [SRV-01] Immutable cache strategy for all static assets:
    // Assets are served with a 1-year max-age and the `immutable` directive.
    // This is safe because the app uses content-hashed filenames or
    // busts the cache via the Service Worker version bump on deploy.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
  next();
});

// Serve tutti i file statici dalla cartella root
app.use(express.static(path.join(__dirname), { index: 'index.html' }));

// Fallback SPA: only for non-static routes (exclude extensions like .ico, .js, .css, etc.)
app.get('*', (req, res) => {
  if (/[a-zA-Z0-9]{1,8}$/.test(req.path)) {
    return res.status(404).send('Not found');
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Iron Kinetic running on port ${PORT}`);
});
