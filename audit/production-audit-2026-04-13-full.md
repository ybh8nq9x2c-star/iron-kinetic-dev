═══════════════════════════════════════════════════════════════
  IRON KINETIC™ — PRODUCTION AUDIT REPORT
  Data: 2026-04-13 22:26 UTC
═══════════════════════════════════════════════════════════════

## EXECUTIVE SUMMARY

Il sistema Iron Kinetic™ è **parzialmente pronto** per il lancio pubblico.
L'infrastruttura Supabase (6 EF ACTIVE, migration, RLS) e Stripe (prodotti, prezzi, webhook)
sono configurate ma presentano **1 blocker critico** (webhook BOOT_ERROR) che impedisce
qualsiasi pagamento venga registrato, e diversi warning di sicurezza e configurazione.

**BLOCKERS (🔴): 4**
**WARNINGS (🟡): 7**
**INFO (🔵): 6**

**Raccomandazione: NO-GO** fino alla risoluzione dei 4 blocker.

---

## 🔴 BLOCKERS

### [BLOCKER-001] stripe-webhook EF in BOOT_ERROR — pagamenti non registrati
- **Dove**: Supabase → Edge Function `stripe-webhook`
- **Problema**: La funzione crasha all'avvio con `503 BOOT_ERROR`. Usa `import { serve } from 'https://deno.land/std@0.168.0/http/function.ts'` (modulo deprecato). Tutte le altre EF usano `Deno.serve()` (API moderna).
- **Impatto**: Nessun pagamento Stripe viene registrato nel database. Gli utenti pagano ma `trend_active` non viene mai aggiornato a `true`. Il referral system è completamente inoperante.
- **Fix**: Sostituire `import { serve }` con `Deno.serve()` nel webhook EF, poi ri-deployare:
```typescript
// RIMUOVERE riga 1:
// import { serve } from 'https://deno.land/std@0.168.0/http/function.ts'

// SOSTITUIRE riga 44:
// serve(async (req) => {
// CON:
Deno.serve(async (req) => {
```
```bash
supabase functions deploy stripe-webhook --project-ref qfmyhgrrkshcqxrwbyle
```

### [BLOCKER-002] create-portal-session EF usa import deprecato — rischio BOOT_ERROR
- **Dove**: Supabase → Edge Function `create-portal-session`
- **Problema**: Usa `import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'` (vecchio pattern). Attualmente funziona ma è lo stesso stile del webhook appena crashato.
- **Impatto**: Se Supabase aggiorna il runtime Deno, questa EF smette di funzionare senza preavviso.
- **Fix**: Convertire a `Deno.serve()`:
```typescript
// RIMUOVERE:
// import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// SOSTITUIRE serve(async (req) => { con Deno.serve(async (req) => {
```

### [BLOCKER-003] Connect onboarding URLs puntano a ironkinetic.app (dominio non attivo)
- **Dove**: Supabase → EF `connect-onboard` (righe 61-62)
- **Problema**: `refresh_url: 'https://ironkinetic.app?connect=refresh'` e `return_url: 'https://ironkinetic.app?connect=success'`. Il dominio `ironkinetic.app` potrebbe non puntare al deployment Railway. L'utente che completa il KYC Stripe Connect viene reindirizzato a un dominio non raggiungibile.
- **Impatto**: Il flusso referral payout è rotto — gli utenti non possono completare l'onboarding bancario.
- **Fix**: Sostituire con il dominio di produzione reale:
```typescript
refresh_url: 'https://irokninetic-production.up.railway.app?connect=refresh',
return_url:  'https://irokninetic-production.up.railway.app?connect=success',
```

### [BLOCKER-004] Stripe Platform Balance €0 — transfer referral fallirebbero
- **Dove**: Stripe → Balance
- **Problema**: Il saldo disponibile sul platform account è €0.00. I transfer per i referral payout (`stripe.transfers.create`) prelevano fondi dal saldo platform, non dal customer.
- **Impatto**: Se un utente accumula ≥€20 di referral credit e richiede un payout, il transfer Stripe fallisce con `Insufficient funds`.
- **Fix**: Prima del lancio:
  1. Accreditare il platform account con almeno €50-100 di fondo di liquidità
  2. Abilitare automatic deposit in Stripe Dashboard → Settings → Payouts
  3. Considerare `destination_payment` con `transfer_group` come alternativa

---

## 🟡 WARNINGS

### [WARN-001] CORS wildcard su 3 EF referral
- **Dove**: `generate-referral-code`, `connect-onboard`, `request-payout`
- **Problema**: `'Access-Control-Allow-Origin': '*'` — accetta richieste da qualsiasi dominio
- **Impatto**: Qualsiasi sito web può chiamare le EF referral se ottiene un JWT utente valido
- **Fix**: Restringere al dominio di produzione:
```typescript
'Access-Control-Allow-Origin': 'https://irokninetic-production.up.railway.app',
```

### [WARN-002] Checkout session aperta senza referral_code
- **Dove**: Stripe → Checkout Session `cs_live_a1lU07...`
- **Problema**: La sessione aperta più recente ha metadata `{plan, supabase_uid, userId}` ma **nessun referral_code**. Il codice frontend lo invia (`referral_code: _ikRefGetPendingCode()`) ma la sessione non lo contiene.
- **Impatto**: Se l'utente completa il pagamento, il referral non viene tracciato
- **Fix**: Verificare che `create-checkout-session` EF legga `referral_code` dal body e lo includa nei metadata Stripe (il codice è presente ma non è chiaro se la versione deployata lo include)

### [WARN-003] Nessuna subscription o customer completata
- **Dove**: Stripe → Subscriptions & Customers
- **Problema**: 0 subscriptions, 0 customers, 0 charges. L'open session (€6.99/monthly) è l'unica prova che il flusso arriva a Stripe. Le 9 sessioni precedenti sono tutte `expired`.
- **Impatto**: Nessun pagamento completato = nessuna prova end-to-end che il flusso billing funzioni
- **Fix**: Completare almeno 1 pagamento di test con carta reale prima del lancio

### [WARN-004] STRIPE_PRICE_* secrets digest mismatch
- **Dove**: Supabase → Secrets
- **Problema**: I digest di `STRIPE_PRICE_MONTHLY` (`e8c2193...`), `STRIPE_PRICE_ANNUAL` (`a9436f3...`), `STRIPE_PRICE_LIFETIME` (`9c8df45...`) differiscono da quelli impostati originalmente. Questo indica che qualcuno li ha sovrascritti via Dashboard.
- **Impatto**: Se i valori non corrispondono ai Price ID corretti, il checkout genera sessioni con prezzi sbagliati o fallisce
- **Fix**: Re-impostare via CLI:
```bash
supabase secrets set --project-ref qfmyhgrrkshcqxrwbyle \
  STRIPE_PRICE_MONTHLY=price_1TLJO9JYTPcSrsvtFVhrRBAT \
  STRIPE_PRICE_ANNUAL=price_1TLJO9JYTPcSrsvts1UjmFlr \
  STRIPE_PRICE_LIFETIME=price_1TLJOAJYTPcSrsvtvdSkbwGr
```

### [WARN-005] generate-referral-code non limita a POST
- **Dove**: EF `generate-referral-code`
- **Problema**: Accetta qualsiasi HTTP method (GET, PUT, DELETE) oltre a POST e OPTIONS. Non c'è un check `if (req.method !== 'POST') return 405`.
- **Impatto**: GET request con token valido genera codici referral, potenzialmente loggando in URL
- **Fix**: Aggiungere method guard:
```typescript
if (req.method !== 'POST' && req.method !== 'OPTIONS')
  return new Response('Method Not Allowed', { status: 405 })
```

### [WARN-006] Nessun rate limiting sulle EF referral
- **Dove**: Tutte le EF referral
- **Problema**: Nessuna implementazione di rate limiting.
- **Impatto**: Potenziale abuso per generare codici referral massivamente
- **Fix**: Implementare rate limiting con counter table o in-memory

### [WARN-007] Frontend prices allineati ma EF usa env vars — doppia fonte di verità
- **Dove**: Frontend + EF `create-checkout-session`
- **Problema**: Il frontend ha Price ID hardcoded nel fallback `priceMap`. L'EF legge da env vars.
- **Impatto**: Inconsistenza se le env var non corrispondono
- **Fix**: L'EF come unica fonte di verità, o endpoint `/prices`

---

## 🔵 INFO / MIGLIORAMENTI

- **🔵 [INFO-001]** Stripe Connect Express non ha branding personalizzato (logo, colore). Aggiungere in Stripe Dashboard → Connect → Settings → Branding.
- **🔵 [INFO-002]** Verificare il piano Supabase attivo. Se Free: 500K rows, 1GB storage, 50K MAU.
- **🔵 [INFO-003]** `tos_acceptance.date: None` nello Stripe account — verificare TOS accettati.
- **🔵 [INFO-004]** Verificare manualmente Supabase Auth settings: Site URL = dominio Railway, nessun localhost nelle Redirect URLs.
- **🔵 [INFO-005]** Verificare backup automatico e PITR in Dashboard → Database → Backups.
- **🔵 [INFO-006]** Il webhook EF non gestisce `customer.subscription.created` — aggiungere se necessario.

---

## VERIFICHE PER SEZIONE

### SEZIONE 1 — SUPABASE DATABASE & SCHEMA

| Verifica | Esito | Note |
|---|---|---|
| Tabelle presenti | ✅ | `users`, `processed_events`, `referral_codes`, `referrals`, `payout_requests` |
| Colonne users estese | ✅ | `referral_credit_cents`, `stripe_connect_account_id`, `stripe_connect_onboarded` |
| FOREIGN KEY con ON DELETE | ✅ | `referral_codes.user_id → auth.users(id) ON DELETE CASCADE` |
| RLS abilitato | ✅ | Su tutte le tabelle referral |
| Funzione SECURITY DEFINER | ✅ | `add_referral_credit` + `consume_referral_credit` con `SET search_path = public` |
| Indici | ✅ | Su `code`, `referrer_id`, `referred_id` |
| EF deployate | ✅ | 6 EF ACTIVE |
| EF webhook operativa | 🔴 | BOOT_ERROR — BLOCKER-001 |
| EF con hardcoded secrets | ✅ | Nessun secret hardcoded |
| CORS restrittivo | 🟡 | 3 EF usano `*` |

### SEZIONE 2 — STRIPE

| Verifica | Esito | Note |
|---|---|---|
| Account live | ✅ | `acct_1TJVZ2JYTPcSrsvt`, IT, `charges_enabled: true` |
| KYC completato | ✅ | `details_submitted: true`, `requirements: []` |
| Product attivo | ✅ | `prod_UIZ9iud5Wv0gAs` — Iron Kinetic Trend |
| Prices live e corretti | ✅ | Monthly €6.99, Annual €69.99, Lifetime €179.99 |
| Vecchi prices | ✅ | 2 archived — non referenziati |
| Webhook endpoint | ✅ | `we_1TJymy...` → Supabase EF, `status: enabled`, 6 eventi |
| Checkout sessions | ⚠️ | 1 open, 9 expired, **0 complete** |
| Subscriptions | ⚠️ | 0 totali |
| Customers | ⚠️ | 0 totali |
| Connect accounts | ⚠️ | 0 totali |
| Disputes | ✅ | 0 |
| Refunds | ✅ | 0 |
| Platform balance | 🔴 | €0.00 |

### SEZIONE 3 — FLUSSO REFERRAL

| Step | Esito | Note |
|---|---|---|
| 1. Generazione codice | ✅ | Idempotente, retry, UNIQUE constraint |
| 2. Tracciamento | ✅ | `?ref=CODE` → localStorage → checkout body |
| 3. Conferma (webhook) | 🔴 | Webhook crasha — BLOCKER-001 |
| 4. Payout | 🔴 | Balance €0 — BLOCKER-004 |
| 5. Idempotenza | ✅ | `processed_events` + UNIQUE `event_id` |
| Auto-referral bloccato | ✅ | Check `user_id !== referredUserId` |
| Double-reward bloccato | ✅ | Check `count > 0` su `referred_id` |

### SEZIONE 4 — SICUREZZA

| Verifica | Esito | Note |
|---|---|---|
| sk_live in frontend | ✅ | 0 occorrenze |
| ANON_KEY (non service_role) | ✅ | Corretta |
| EF usano Deno.env.get() | ✅ | Nessun secret hardcoded |
| CORS wildcard | 🟡 | 3 EF — WARN-001 |
| JWT validation | ✅ | Tutte le EF referral verificano token |
| Webhook senza JWT | ✅ | Corretto per Stripe |

---

## CHECKLIST FINALE PRE-LANCIO

- [ ] **[BLOCKER-001]** Fix stripe-webhook: `import { serve }` → `Deno.serve()`, ri-deploy
- [ ] **[BLOCKER-002]** Fix create-portal-session: stesso fix `Deno.serve()`, ri-deploy
- [ ] **[BLOCKER-003]** Fix connect-onboard URLs: `ironkinetic.app` → `irokninetic-production.up.railway.app`
- [ ] **[BLOCKER-004]** Accreditare Stripe Platform Balance (≥€50)
- [ ] **[WARN-001]** Restringere CORS su 3 EF referral al dominio Railway
- [ ] **[WARN-004]** Re-impostare STRIPE_PRICE_* secrets via CLI
- [ ] Stripe in modalità live ✅
- [ ] Webhook endpoint attivo e verificato ✅
- [ ] RLS abilitato su tutte le tabelle utente ✅
- [ ] Nessuna API key live esposta nel frontend ✅
- [ ] Webhook idempotente ✅
- [ ] Backup DB abilitato ⚠️ (verificare in Dashboard)
- [ ] E2E test pagamento completato (0 prove finora)
- [ ] Connect Express branding configurato
- [ ] Supabase Auth Redirect URLs senza localhost

---

*Report generato da Agent Zero — 2026-04-13T22:26Z*
*File: /a0/usr/projects/iron_kninetic/audit/production-audit-2026-04-13-full.md*
