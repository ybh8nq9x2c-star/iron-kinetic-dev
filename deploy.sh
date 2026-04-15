#!/bin/bash
set -e

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Iron Kinetic — Deploy Script"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 1. Verifica che siamo su dev
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "dev" ]; then
  echo "❌ ERRORE: Sei su branch '$BRANCH'. Devi essere su 'dev'."
  echo "   Esegui: git checkout dev"
  exit 1
fi

# 2. Backup del file principale
TIMESTAMP=$(date +%Y%m%d_%H%M)
if [ -f "index.html" ]; then
  cp index.html backups/index.backup.$TIMESTAMP.html
  echo "✅ Backup creato: backups/index.backup.$TIMESTAMP.html"
fi

# 3. Syntax check JS (se node è disponibile)
if command -v node &> /dev/null; then
  echo "🔍 Syntax check..."
  node -e "
    const fs = require('fs');
    const html = fs.readFileSync('index.html', 'utf8');
    const scripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
    let ok = true;
    scripts.forEach((s, i) => {
      const code = s.replace(/<script[^>]*>/i,'').replace(/<\/script>/i,'');
      try { new Function(code); }
      catch(e) { console.error('Script block', i, ':', e.message); ok = false; }
    });
    if (ok) console.log('✅ Syntax OK');
    else process.exit(1);
  "
  if [ $? -ne 0 ]; then
    echo "❌ ERRORE SYNTAX — deploy bloccato. Correggi prima di deployare."
    exit 1
  fi
fi

# 4. Merge dev → main e push
echo "🚀 Merge dev → main..."
git checkout main
git pull origin main
git merge dev --no-ff -m "deploy: $TIMESTAMP"
git push origin main

echo ""
echo "✅ Deploy avviato! Railway sta deployando su produzione."
echo "   Monitoraggio: https://railway.app"
echo ""

# 5. Torna su dev per il prossimo task
git checkout dev
echo "↩️  Tornato su branch dev. Pronto per il prossimo task."
