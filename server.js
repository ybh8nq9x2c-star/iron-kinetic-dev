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
    // Tutti gli altri asset statici: cache 1 anno (cambiano raramente)
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
  next();
});

// Serve tutti i file statici dalla cartella root
app.use(express.static(path.join(__dirname), { index: 'index.html' }));

// Fallback SPA: qualsiasi route non trovata → index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Iron Kinetic running on port ${PORT}`);
});
