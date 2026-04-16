const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

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
  if (/\.[a-zA-Z0-9]{1,8}$/.test(req.path)) {
    return res.status(404).send('Not found');
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Iron Kinetic running on port ${PORT}`);
});
