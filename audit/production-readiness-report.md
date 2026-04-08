# IRON KINETIC — Production-Readiness Audit Report

**Date:** 2026-04-08 | **Auditor:** Agent Zero Deep Research | **Verdict: NOT READY**

---

## 1. Executive Summary

Iron Kinetic is a single-file PWA nutrition coaching app (8843-line `index.html`) with Supabase auth, Stripe billing, and Railway hosting. The codebase is architecturally ambitious but contains **multiple production-blocking defects** that would cause immediate revenue loss and security exposure at launch.

**The checkout flow is broken** due to a frontend-backend protocol mismatch. The Stripe integration uses test keys. Edge Functions are not deployed. The webhook endpoint is not configured. The annual price does not exist in Stripe. A localStorage bypass allows users to self-grant paid access. RLS policies allow users to set their own `trend_active` flag.

**Global Verdict: NOT READY** — requires 8–12 focused remediation sessions before go-live.

---

## 2. Domain Scorecard

| Domain | Score (0–5) | Status | Key Issue |
|--------|-------------|--------|-----------|
| A) Product/UX | 3.0 | NEEDS WORK | Mixed IT/EN strings, onboarding solid |
| B) Billing/Payments | 0.5 | CRITICAL | Checkout broken, test keys, not deployed |
| C) Auth/Identity | 3.5 | GOOD | Google OAuth works, session handling solid |
| D) Supabase Security | 2.0 | WEAK | RLS self-update hole, anon key exposed |
| E) App Security | 1.5 | WEAK | 16 unsanitized innerHTML, no CSP, no SRI |
| F) PWA/Offline | 3.0 | GOOD | Solid SW, offline.html exists, cache strategy OK |
| G) Performance | 2.0 | WEAK | 8843-line monolith, eager CDN loads, no code splitting |
| H) Observability | 0.5 | CRITICAL | No monitoring, no error tracking, no runbook |
| I) Legal/Privacy | 3.5 | GOOD | GDPR gate, consent flow, Art. 9 disclosure |

**Overall Weighted Score: 2.2 / 5.0**

---

## 3. All Findings with Evidence

### FINDING B-01 — Frontend-Edge Function Checkout Protocol Mismatch
- **Domain:** B) Billing/Payments
- **Severity:** CRITICAL
- **Evidence:** 
  - `index.html:2109-2126` — Frontend sends `{priceId, mode, successUrl, cancelUrl, customerEmail}`
  - `create-checkout-session/index.ts:50` — Edge Function expects `{price_tier}`
- **Why it matters:** Every checkout attempt will either 400 (invalid price_tier) or silently create a session with wrong parameters. **Zero revenue possible.**
- **Remediation:** Align frontend to send `{price_tier: 'monthly'}` or update Edge Function to accept `{priceId, mode}`. Prefer the former (env-var mapping is more secure).
- **Effort:** S
- **Blocker for go-live:** YES

### FINDING B-02 — Stripe Test Key Hardcoded in Production Bundle
- **Domain:** B) Billing/Payments
- **Severity:** CRITICAL
- **Evidence:** `index.html:1981` — `const STRIPE_PK='pk_test_51TJVZHJ1bJ8OCtTA...'`
- **Why it matters:** All checkout sessions use Stripe test mode. No real payments can be processed. Test cards will work; real cards will not.
- **Remediation:** Replace with `pk_live_...` key before deploy, or better: inject via environment variable at build time or use a config endpoint.
- **Effort:** S
- **Blocker for go-live:** YES

### FINDING B-03 — STRIPE_ANNUAL is Placeholder
- **Domain:** B) Billing/Payments
- **Severity:** CRITICAL
- **Evidence:** `index.html:1980` — `const STRIPE_ANNUAL='STRIPE_PRICE_ANNUAL_PLACEHOLDER'`
- **Why it matters:** Annual checkout attempts will fail with invalid price ID.
- **Remediation:** Create annual price in Stripe Dashboard, copy `price_xxx` ID, replace placeholder.
- **Effort:** S
- **Blocker for go-live:** YES (for annual tier)

### FINDING B-04 — Edge Functions Not Deployed
- **Domain:** B) Billing/Payments
- **Severity:** CRITICAL
- **Evidence:** Functions exist at `supabase/functions/` but no deployment record; memory confirms "Edge Functions NOT yet deployed"
- **Why it matters:** All `/functions/v1/*` calls return 404. Checkout, portal, and webhooks are non-functional.
- **Remediation:** `supabase functions deploy create-checkout-session`, `supabase functions deploy create-portal-session`, `supabase functions deploy stripe-webhook`. Set all 6 secrets.
- **Effort:** S
- **Blocker for go-live:** YES

### FINDING B-05 — Stripe Webhook Endpoint Not Configured
- **Domain:** B) Billing/Payments
- **Severity:** CRITICAL
- **Evidence:** No Stripe webhook endpoint pointing to Supabase Edge Function URL
- **Why it matters:** Even if checkout works, payment confirmation never arrives. `trend_active` never set server-side. Users pay but don't get access.
- **Remediation:** In Stripe Dashboard → Webhooks → Add endpoint: `https://qfmyhgrrkshcqxrwbyle.supabase.co/functions/v1/stripe-webhook` with events: `checkout.session.completed`, `invoice.payment_succeeded`, `customer.subscription.deleted`, `invoice.payment_failed`. Copy signing secret to `STRIPE_WEBHOOK_SECRET` env var.
- **Effort:** S
- **Blocker for go-live:** YES

### FINDING B-06 — Checkout Success Activates Locally Before Webhook
- **Domain:** B) Billing/Payments
- **Severity:** HIGH
- **Evidence:** `index.html:2276-2282` — `localStorage.setItem('ik_trend_active','1')` on `?trend=success` URL param
- **Why it matters:** User gets immediate paid access via localStorage, but if webhook fails or is delayed, the server never confirms. On next login from different device, access reverts to free. Also: URL param can be spoofed by anyone typing `?trend=success`.
- **Remediation:** Remove optimistic local activation. Show "processing" state, poll Supabase `users.trend_active` every 5s for up to 60s after redirect. Or keep optimistic but verify server-side on next boot.
- **Effort:** M
- **Blocker for go-live:** NO (but severe UX issue)

### FINDING D-01 — RLS Allows Users to Self-Set trend_active
- **Domain:** D) Supabase Security
- **Severity:** CRITICAL
- **Evidence:** `20260408_billing_schema.sql:136-146` — `CREATE POLICY "Users can update own row" ON public.users FOR UPDATE USING (auth.uid() = id)` with no column restriction
- **Why it matters:** Any authenticated user can run `supabase.from('users').update({trend_active: true, plan: 'lifetime'}).eq('id', myId)` from browser console. Free lifetime access for every logged-in user.
- **Remediation:** Replace blanket UPDATE policy with column-restricted policy: `UPDATE USING (auth.uid() = id)` but only allowing updates to non-billing columns. Or use a database trigger that prevents direct `trend_active`/`plan` updates from anon key context.
- **Effort:** M
- **Blocker for go-live:** YES

### FINDING D-02 — localStorage Bypass for Paid Status
- **Domain:** D) Supabase Security
- **Severity:** HIGH
- **Evidence:** `index.html:2006` — `if(localStorage.getItem('ik_trend_active')==='1')return{access:true,mode:'paid'}`
- **Why it matters:** Opening browser console and typing `localStorage.setItem('ik_trend_active','1')` grants full Trend access. No server verification on the critical path.
- **Remediation:** Always verify with Supabase before granting paid access. Use localStorage only as a display cache, not as an entitlement source. The `checkTrendAccess()` function does check Supabase for logged-in users, but the short-circuit at line 2006 bypasses it.
- **Effort:** S
- **Blocker for go-live:** NO (but revenue leak)

### FINDING D-03 — SUPABASE_KEY (Anon Key) Used as Bearer Fallback
- **Domain:** D) Supabase Security
- **Severity:** HIGH
- **Evidence:** `index.html:2116` — `'Authorization': 'Bearer '+(accessToken||SUPABASE_KEY)`
- **Why it matters:** Unauthenticated users send the anon key as Authorization header to create-checkout-session. The Edge Function's `authClient.auth.getUser()` will fail, but the flow may still proceed if error handling is loose.
- **Remediation:** Require authentication before checkout. Remove SUPABASE_KEY fallback. Show auth modal if not logged in.
- **Effort:** S
- **Blocker for go-live:** NO (but security issue)

### FINDING E-01 — 16 innerHTML Calls Without sanitize()
- **Domain:** E) App Security
- **Severity:** HIGH
- **Evidence:**
  - `index.html:3405` — `el.innerHTML=_HELP_FEATURES.map(...)` (template literal injection)
  - `index.html:4389` — `cont.innerHTML=`<div...>` (grid layout injection)
  - `index.html:4607` — `cont.innerHTML=`<div...>` (grid layout injection)
  - `index.html:6055` — `previewEl.innerHTML=html` (meal plan preview)
  - `index.html:6172` — `lockBanner.innerHTML=` (trend lock banner)
  - `index.html:7011` — `btnRow.innerHTML=` (confirm buttons)
  - `index.html:7081` — `msgEl.innerHTML=` (reset profile dialog)
  - `index.html:7152` — `el.innerHTML=log.map(...)` (history list)
  - `index.html:7553` — `shopEl.innerHTML=html` (shopping list)
  - `index.html:7867` — `calEl.innerHTML=html` (adherence calendar)
- **Why it matters:** While most data sources are internal (i18n keys, generated meal plans), the pattern is unsafe. If any user input (weight, food preferences, extra foods) flows through these without sanitization, XSS is possible. The `sanitize()` helper exists but is not consistently applied.
- **Remediation:** Audit each innerHTML call. Replace with `textContent` where possible. Apply `sanitize()` to all dynamic content. Long-term: migrate to `createElement()` pattern.
- **Effort:** L
- **Blocker for go-live:** NO (but high risk)

### FINDING E-02 — No Content Security Policy (CSP) Headers
- **Domain:** E) App Security
- **Severity:** HIGH
- **Evidence:** No CSP header in `Dockerfile`, `railway.toml`, or any server config
- **Why it matters:** Without CSP, any injected script (via XSS) can load external resources, exfiltrate data, or redirect users. Essential for a health-data app.
- **Remediation:** Add CSP header via `serve` middleware or reverse proxy: `Content-Security-Policy: default-src 'self'; script-src 'self' https://cdn.jsdelivr.net https://js.stripe.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src https://qfmyhgrrkshcqxrwbyle.supabase.co https://api.stripe.com`
- **Effort:** M
- **Blocker for go-live:** NO (but strong recommendation)

### FINDING E-03 — No Subresource Integrity (SRI) on CDN Scripts
- **Domain:** E) App Security
- **Severity:** MEDIUM
- **Evidence:** `index.html:669-670` — `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2">` and `<script src="https://js.stripe.com/v3/">` without `integrity` attribute
- **Why it matters:** If CDN is compromised, arbitrary JS executes in your origin with access to localStorage (health data) and Stripe session.
- **Remediation:** Add `integrity="sha384-..."` and `crossorigin="anonymous"` to both script tags. Pin exact versions.
- **Effort:** S
- **Blocker for go-live:** NO

### FINDING E-04 — CORS Wildcard on Edge Functions
- **Domain:** E) App Security
- **Severity:** MEDIUM
- **Evidence:** `create-checkout-session/index.ts:6` and `create-portal-session/index.ts:6` — `'Access-Control-Allow-Origin': '*'`
- **Why it matters:** Any website can make checkout requests on behalf of a logged-in user if they obtain their JWT (e.g., via XSS).
- **Remediation:** Set `Access-Control-Allow-Origin` to `https://irokninetic-production.up.railway.app` (or the production domain).
- **Effort:** S
- **Blocker for go-live:** NO (but security hardening)

### FINDING E-05 — Health Data in localStorage Unencrypted
- **Domain:** E) App Security
- **Severity:** MEDIUM
- **Evidence:** `index.html:1991` and throughout — weight, body fat, measurements stored as plaintext JSON in localStorage keys like `ik_user_profile`, `ik_weight_log`, `ik_checkins`
- **Why it matters:** Any script running in the page context (XSS, malicious extension) can read all health data. GDPR Art. 9 requires appropriate technical measures for health data.
- **Remediation:** For anonymous users: accept localStorage limitation but document it in privacy policy (already done). For authenticated users: prioritize Supabase storage with encryption at rest. Add a note that localStorage data is accessible to the device user only.
- **Effort:** M
- **Blocker for go-live:** NO (acceptable for MVP with current privacy policy)

### FINDING A-01 — Mixed IT/EN Strings in Onboarding and App
- **Domain:** A) Product/UX
- **Severity:** MEDIUM
- **Evidence:** 97 elements with `class="sn"` (static, not i18n-translated) vs 33 elements with `data-i18n` attributes. Onboarding food tags are all Italian (lines 1000-1057): `Coscia pollo`, `Riso basmati`, etc. These never change with language selection.
- **Why it matters:** English-language users see Italian food names, Italian labels on static elements. Inconsistent experience.
- **Remediation:** Audit all `class="sn"` elements. Add `data-i18n` keys for each. Translate food tag labels in `LANG.en` object.
- **Effort:** L
- **Blocker for go-live:** NO

### FINDING A-02 — Trend Lock Banner Cross-Screen Bleed
- **Domain:** A) Product/UX
- **Severity:** MEDIUM
- **Evidence:** `index.html:654-657` — `#trend-lock-banner` uses `position:sticky;top:0;z-index:10`. Lock banner CSS classes `.locked-trend` and `.locked-card` apply to `#scr-prog`.
- **Why it matters:** If the lock banner state persists across tab switches, it can bleed into other screens. Recent fix appears to contain it to `#scr-prog`, but the sticky positioning could cause overlap with the header.
- **Remediation:** Verify that `trend-lock-banner` display state is reset on `switchTab()` to non-prog tabs. Add explicit `lockBanner.style.display='none'` in switchTab.
- **Effort:** S
- **Blocker for go-live:** NO

### FINDING F-01 — SW Version Mismatch in CLAUDE.md
- **Domain:** F) PWA/Offline
- **Severity:** LOW
- **Evidence:** `CLAUDE.md` says `v15`, `sw.js` says `const CACHE = 'iron-kinetic-v16'`
- **Why it matters:** Documentation drift causes confusion during debugging.
- **Remediation:** Update CLAUDE.md to reflect v16.
- **Effort:** XS
- **Blocker for go-live:** NO

### FINDING F-02 — Manifest lang Hardcoded to Italian
- **Domain:** F) PWA/Offline
- **Severity:** LOW
- **Evidence:** `manifest.webmanifest` — `"lang": "it"`
- **Why it matters:** English users install a PWA that declares Italian as its language. OS may show Italian app name in settings.
- **Remediation:** Dynamically generate manifest with correct `lang` value, or set to `"en"` as default since it's more universal.
- **Effort:** S
- **Blocker for go-live:** NO

### FINDING F-03 — offline.html Hardcoded Italian
- **Domain:** F) PWA/Offline
- **Severity:** LOW
- **Evidence:** `offline.html` — `Sei offline. Riconnettiti per sincronizzare.`
- **Why it matters:** English users see Italian offline message.
- **Remediation:** Use JavaScript to detect language and show appropriate message, or make it bilingual.
- **Effort:** S
- **Blocker for go-live:** NO

### FINDING G-01 — 8843-Line Monolith Architecture
- **Domain:** G) Performance
- **Severity:** HIGH
- **Evidence:** Entire app (HTML + CSS + JS) in single `index.html` file, 8843 lines
- **Why it matters:** Browser must parse ~300KB of HTML+JS before first paint. No code splitting, no lazy loading of features. Every page load downloads the entire app including unused features (shopping list, fingerprint, weekly report).
- **Remediation:** Phase 2: Extract JS into modules, implement dynamic imports for Chart.js-heavy features, split CSS. For now: acceptable for MVP.
- **Effort:** L
- **Blocker for go-live:** NO

### FINDING G-02 — Eager External Resource Loading
- **Domain:** G) Performance
- **Severity:** MEDIUM
- **Evidence:** `index.html:669-670` — Supabase and Stripe SDKs loaded synchronously in `<head>`. Chart.js loaded lazily (good). Google Fonts use `media="print"` trick (good).
- **Why it matters:** Supabase SDK (~50KB) and Stripe SDK (~100KB) block rendering. On slow connections, this adds 1-3s to first paint.
- **Remediation:** Add `async` or `defer` to script tags, or load dynamically after first paint.
- **Effort:** S
- **Blocker for go-live:** NO

### FINDING H-01 — No Error Monitoring or Logging
- **Domain:** H) Observability
- **Severity:** HIGH
- **Evidence:** Only `console.error` and `console.log` throughout. No Sentry, no LogRocket, no analytics.
- **Why it matters:** Production bugs are invisible. No way to know if checkout fails, if auth breaks, if users hit black screens.
- **Remediation:** Integrate Sentry (free tier) for error tracking. Add structured logging to Edge Functions.
- **Effort:** M
- **Blocker for go-live:** NO (but highly recommended)

### FINDING H-02 — No Rollback Strategy
- **Domain:** H) Observability
- **Severity:** MEDIUM
- **Evidence:** No documented rollback procedure. Railway auto-deploys on push to main.
- **Why it matters:** A bad deploy immediately hits production with no documented way to revert.
- **Remediation:** Document: `git revert HEAD && git push` or use Railway's rollback feature. Pin deploy versions.
- **Effort:** S
- **Blocker for go-live:** NO

### FINDING I-01 — Age Gate Missing
- **Domain:** I) Legal/Privacy
- **Severity:** MEDIUM
- **Evidence:** Privacy policy states "reserved to users aged >= 16" (GDPR Art. 8), but no age verification gate exists in the app flow.
- **Why it matters:** GDPR Art. 8 requires verifiable parental consent for users under 16 (Italy). Without any age check, the app is non-compliant.
- **Remediation:** Add a simple age confirmation checkbox to the GDPR consent gate: "I confirm I am 16 years or older". This is the minimum acceptable approach.
- **Effort:** S
- **Blocker for go-live:** NO (but legal risk)

### FINDING I-02 — Privacy Policy States "No Server Data" but Supabase Exists
- **Domain:** I) Legal/Privacy
- **Severity:** MEDIUM
- **Evidence:** `index.html:1789-1790` — `Dati su server: Nessuno ✓` in the Info tab. But authenticated users sync to Supabase.
- **Why it matters:** Contradicts the privacy policy. Misleading users about data handling.
- **Remediation:** Update this label to be conditional: "Nessuno (locale)" for anonymous users, "Supabase (EU)" for authenticated users.
- **Effort:** S
- **Blocker for go-live:** NO

### FINDING MISC-01 — Package Name Inconsistent
- **Domain:** G) Performance
- **Severity:** LOW
- **Evidence:** `package.json` — `"name": "dietpro-pwa"` vs product name "Iron Kinetic"
- **Why it matters:** Minor confusion in build/deploy tooling.
- **Remediation:** Rename to `"iron-kinetic"` or `"iron-kinetic-pwa"`.
- **Effort:** XS
- **Blocker for go-live:** NO

---

## 4. Pass/Fail Gate Table

| Gate | Criteria | Status | Notes |
|------|----------|--------|-------|
| Checkout flow E2E | User can complete payment and get access | FAIL | Protocol mismatch, test keys |
| Webhook processing | Payment confirmed server-side within 60s | FAIL | Not deployed, not configured |
| Test card exclusion | Real Stripe keys in production | FAIL | pk_test hardcoded |
| Annual tier | Annual price checkout works | FAIL | Placeholder price ID |
| RLS billing protection | Users cannot self-grant access | FAIL | UPDATE policy too broad |
| XSS prevention | No unsanitized user content in DOM | WARN | 16 innerHTML without sanitize |
| GDPR consent gate | Consent before data processing | PASS | Gate works, Art. 9 disclosed |
| Auth flow | Google OAuth login/logout | PASS | Works with session handling |
| PWA install | Manifest + SW valid | PASS | Installable, offline works |
| Trial flow | 7-day trial activates correctly | PASS | Local trial logic works |
| Grace period | 48h grace on payment failure | PASS | Webhook logic handles it |
| Idempotency | Duplicate events don't double-process | PASS | processed_events table |
| i18n IT/EN | Full bilingual coverage | WARN | 97 static elements untranslated |
| CSP headers | Content Security Policy present | FAIL | None configured |
| Error monitoring | Production errors tracked | FAIL | No monitoring solution |
| Age verification | >= 16 gate or confirmation | FAIL | Mentioned in policy but not enforced |
| Billing portal | Users can manage subscription | FAIL | Edge Function not deployed |

---

## 5. Top 5 Blockers + Top 5 Nice-to-Haves

### Top 5 Go-Live Blockers

1. **B-01: Checkout protocol mismatch** — Frontend sends wrong payload shape to Edge Function. Zero revenue.
2. **B-02: Stripe test key in production** — No real payments possible.
3. **B-04 + B-05: Edge Functions not deployed + Webhook not configured** — Server-side billing is completely non-functional.
4. **D-01: RLS self-update vulnerability** — Any user can set `trend_active=true` via Supabase client.
5. **B-03: Annual price placeholder** — Annual tier will 400.

### Top 5 Nice-to-Haves

1. **H-01: Sentry integration** — Essential for post-launch debugging.
2. **E-02: CSP headers** — Critical security hardening for health data app.
3. **A-01: Full i18n coverage** — 97 static elements need translation keys.
4. **G-01: Code splitting** — 8843-line monolith is the biggest long-term maintainability risk.
5. **I-01: Age confirmation gate** — Simple checkbox, significant GDPR compliance improvement.

---

## 6. Prioritized Remediation Backlog

### Phase 1: Go-Live Blockers (Est. 4-6 hours)

| # | Finding | Action | Effort |
|---|---------|--------|--------|
| 1 | B-01 | Fix frontend `startCheckout()` to send `{price_tier}` instead of `{priceId, mode, ...}` | S |
| 2 | B-02 | Replace `STRIPE_PK` with `pk_live_...` key | S |
| 3 | B-03 | Create annual price in Stripe, replace placeholder | S |
| 4 | B-04 | Deploy 3 Edge Functions + set 6 secrets | S |
| 5 | B-05 | Configure Stripe webhook endpoint + signing secret | S |
| 6 | D-01 | Restrict RLS UPDATE policy to exclude billing columns | M |
| 7 | B-06 | Add server verification for `?trend=success` flow | S |

### Phase 2: Security Hardening (Est. 4-6 hours)

| # | Finding | Action | Effort |
|---|---------|--------|--------|
| 8 | E-02 | Add CSP headers via serve middleware or Railway config | M |
| 9 | E-03 | Add SRI hashes to CDN script tags | S |
| 10 | E-04 | Restrict CORS to production domain | S |
| 11 | D-02 | Remove localStorage short-circuit for paid status | S |
| 12 | D-03 | Require auth before checkout, remove anon key fallback | S |
| 13 | E-01 | Audit and sanitize all 16 innerHTML calls | L |

### Phase 3: UX & Compliance (Est. 3-4 hours)

| # | Finding | Action | Effort |
|---|---------|--------|--------|
| 14 | I-01 | Add age confirmation to GDPR gate | S |
| 15 | I-02 | Make server-data label conditional on auth status | S |
| 16 | A-01 | Add i18n keys for remaining static elements + food tags | L |
| 17 | A-02 | Verify lock banner resets on tab switch | S |
| 18 | F-02 | Dynamic manifest lang | S |
| 19 | F-03 | Bilingual offline page | S |

### Phase 4: Observability & Performance (Est. 4-6 hours)

| # | Finding | Action | Effort |
|---|---------|--------|--------|
| 20 | H-01 | Integrate Sentry for frontend + Edge Function errors | M |
| 21 | H-02 | Document rollback procedure | S |
| 22 | G-02 | Add async/defer to external scripts | S |
| 23 | MISC-01 | Rename package to iron-kinetic | XS |
| 24 | F-01 | Update CLAUDE.md SW version | XS |

---

## Appendix A: Verified File Inventory

| File | Lines | Status |
|------|-------|--------|
| `index.html` | 8843 | Audited (full scan) |
| `supabase/functions/stripe-webhook/index.ts` | 217 | Audited |
| `supabase/functions/create-checkout-session/index.ts` | 110 | Audited |
| `supabase/functions/create-portal-session/index.ts` | 86 | Audited |
| `supabase/migrations/20260408_billing_schema.sql` | 193 | Audited |
| `sw.js` | ~70 | Audited |
| `manifest.webmanifest` | ~25 | Audited |
| `Dockerfile` | 6 | Audited |
| `railway.toml` | 4 | Audited |
| `package.json` | 8 | Audited |
| `CLAUDE.md` | ~200 | Audited |
| `offline.html` | ~20 | Audited |

## Appendix B: Environment Secrets Required

The following secrets must be set in Supabase Edge Function environment before go-live:

1. `STRIPE_SECRET_KEY` — `sk_live_...`
2. `STRIPE_WEBHOOK_SECRET` — `whsec_...`
3. `STRIPE_PRICE_MONTHLY` — `price_1TJVc6J1bJ8OCtTAnDcsUnSm`
4. `STRIPE_PRICE_ANNUAL` — (to be created)
5. `STRIPE_PRICE_LIFETIME` — `price_1TJVc7J1bJ8OCtTAbZv41Ozc`
6. `SUPABASE_URL` — `https://qfmyhgrrkshcqxrwbyle.supabase.co`
7. `SUPABASE_ANON_KEY` — (current publishable key)
8. `SUPABASE_SERVICE_ROLE_KEY` — (from Supabase Dashboard)
9. `APP_URL` — `https://irokninetic-production.up.railway.app`

## Appendix C: Unknowns (Cannot Verify Without Access)

- Whether RLS policies are actually enabled on the production Supabase instance (migration may not have been run)
- Whether `processed_events` table exists in production
- Whether Stripe annual price has been created (likely not per placeholder)
- Whether `STRIPE_SECRET_KEY` env var is set in Supabase
- Whether any users have already been created in the `users` table
- Exact Railway deployment logs and build status
- Whether Supabase Dashboard has Google OAuth provider configured correctly
- Whether `APP_URL` env var is set correctly
- Whether `serve` package version has known vulnerabilities

---

**END OF AUDIT REPORT**