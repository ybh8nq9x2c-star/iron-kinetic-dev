# Iron Kinetic — Regole Agente

## BRANCH RULE (NON NEGOZIABILE)
- Lavora SEMPRE su branch `dev`
- NON pushare mai su `main` direttamente
- Prima di qualsiasi lavoro: `git checkout dev && git pull origin dev`

## WORKFLOW PER OGNI TASK
1. `git checkout dev`
2. `git pull origin dev`
3. Fai le modifiche
4. `git add . && git commit -m "fix: [descrizione breve]"`
5. `git push origin dev`
6. Riporta nell'output: cosa hai cambiato, file modificati, commit hash

## DEPLOY SU PRODUZIONE
- NON è compito dell'agente
- L'utente esegue `./deploy.sh` quando ha verificato lo staging
- L'agente NON deve mai eseguire deploy.sh o toccare main

## BACKUP OBBLIGATORIO
Prima di modificare index.html:
`cp index.html backups/index.backup.$(date +%Y%m%d_%H%M).html`

## IN CASO DI ERRORE
- NON pushare codice rotto
- Ripristina con: `git checkout -- index.html`
- Riportami l'errore completo prima di riprovare
