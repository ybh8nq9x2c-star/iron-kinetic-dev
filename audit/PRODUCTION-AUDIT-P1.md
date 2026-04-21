# Iron Kinetic — Comprehensive Production Audit P1

**Date:** 2026-04-20
**Scope:** index.html (11,222 lines), sw.js, server.js, serve.json, 8 Edge Functions, 9 SQL migrations
**Auditor:** Agent Zero Deep Research
**Mode:** ANALYSIS ONLY — ZERO FIXES — REPORT ONLY

---

## Executive Summary

Full production audit across 6 domains identified **3 CRITICAL regressions**, **4 HIGH**, **10 MEDIUM**, and **9 LOW** severity issues. Three previously-documented security fixes have **regressed** — the `verify-subscription` Edge Function is completely bypassed by the client, `_trendState` defaults to `access:true`, and client-side trial bypass via localStorage manipulation is fully functional.

| Domain | CRITICAL | HIGH | MEDIUM | LOW | Total |
|--------|----------|------|--------|-----|-------|
| 1. Client-Side Security | 3 | 1 | 3 | 3 | 10 |
| 2. Supabase/DB/RLS | 0 | 2 | 2 | 3 | 7 |
| 3. Stripe/Payments | 0 | 0 | 1 | 1 | 2 |
| 4. Boot/Auth State | 0 | 0 | 2 | 2 | 4 |
| 5. Storage/State | 0 | 1 | 1 | 0 | 2 |
| 6. SW/PWA | 0 | 0 | 1 | 0 | 1 |
| **TOTAL** | **3** | **4** | **10** | **9** | **26** |

---

## 🔴 REGRESSION ALERT — Previously Fixed Issues Now Broken

| # | Documented Fix | Current State | Evidence |
|---|---------------|---------------|----------|
| R1 | `_trendState` defaults `{access:false, mode:'none'}` | **REGRESSED** → `{access:true, mode:'trial'}` | index.html L2638 |
| R2 | `checkTrendAccess()` calls `verify-subscription` EF | **REGRESSED** → direct `sb.from('users').select()` | index.html L2673 |
| R3 | `_checkTrendLocal()` returns `{access:false}` only | **REGRESSED** → returns `{access:true, mode:'trial'}` when valid | index.html L2645-2660 |

These regressions represent the **most urgent business risk** — the entire server-side subscription verification architecture is bypassed.

---

## AREA 1: SICUREZZA CLIENT-SIDE

### 1a. Hardcoded Secrets

**[OK] No exposed secret keys found.**

| Line | Value | Assessment |
|------|-------|------------|
| 2629 | `SUPABASE_URL` | Public project URL — acceptable |
| 2630 | `SUPABASE_KEY` (JWT `role:anon`) | Anon key — designed for client use |
| 2632 | `STRIPE_PK` (`pk_live_51TJVZ2...`) | Publishable key — designed for client use |
| 1127 | Sentry init (CDN script, no DSN inline) | Public DSN — acceptable |

No `service_role`, `sk_live`, webhook secrets, or API secrets found in client code. ✅

---

### 1b. XSS / Injection

**[OK] All innerHTML with dynamic data uses `sanitize()` function (L3481).**

The `sanitize()` function is a proper HTML entity encoder using `textContent`→`innerHTML` pattern. Verified at lines: 2763, 2806, 2834, 2855, 2873, 4875, 4969, 5845, 6136, 7862, 8151, 8285, 8609, 9097-9105, 9486, 9841, 10009-10014, 10566.

**No dangerous patterns found:**
- Zero `eval()` calls ✅
- Zero `new Function()` calls ✅
- Zero `document.write()` calls ✅

**[LOW] Area 1b > XSS > Numeric innerHTML without sanitize**
Riga/Funzione: L8808
Problema: `tdeeDisp.innerHTML` uses `Math.round(_tkc)` in template literal without `sanitize()`. Value is always numeric from internal calculation.
Impatto: Negligible — `_tkc` is always a number from `Math.round()`. No injection vector.

**[LOW] Area 1b > XSS > Confirm modal innerHTML**
Riga/Funzione: L8959, L9030, L9104
Problema: innerHTML with `t()` i18n translation values — developer-controlled dictionary, not user input.
Impatto: Negligible — translation dictionary is hardcoded.

**[LOW] Area 1b > XSS > Avatar URL via img.src**
Riga/Funzione: L8743 (`_applyUserAvatar`)
Problema: Avatar URL from `localStorage.getItem('ik_user_avatar')` set as `img.src` without validation.
Impatto: Low — browsers don't execute JS from `img.src`. Limited to loading an external image.

---

### 1c. Auth / OAuth Flow

**[OK] URL token cleanup implemented:**
L3419: IIFE strips `#access_token=...` from URL hash at script parse time. ✅

**[OK] ik_auth_origin handling:**
- Set at L3178 (checkout), L3260 (post_onboarding)
- Read and cleared at L3332-3334, L3359-3365
- Value is a simple enum string — no injection risk
- Properly cleaned up with `localStorage.removeItem()` after use ✅

**[MEDIUM] Area 1c > Auth > Race condition in onAuthStateChange**
Riga/Funzione: L3321 (`_initAuthListener`)
Problema: `onAuthStateChange` handler performs multiple async operations: `syncUserAfterLogin()`, `initTrend()`, `_doStartCheckout()`. The handler can fire multiple times rapidly (token refresh, session recovery), causing duplicate calls.
Impatto: Medium — transient UI glitches, duplicate DB writes, inconsistent state during rapid auth transitions. Mitigated by `trendInitPromise` pattern for `initTrend()`.

**[LOW] Area 1c > Auth > Token in URL timing window**
Riga/Funzione: L3419
Problema: OAuth tokens remain in `location.hash` during the brief interval between page load and the IIFE executing. If a Referer header is sent to an external resource during this window, the token could leak.
Impatto: Low — modern browsers strip fragment identifiers from Referer headers by default.

**[LOW] Area 1c > Auth > ik_auth_origin manipulation via dev tools**
Riga/Funzione: L3178, L3332
Problema: Attacker with dev tools could set `ik_auth_origin` to trigger unintended flows (checkout, auth gate).
Impatto: Low — worst case is triggering a checkout flow that fails without valid payment credentials.

---

### 1d. Trial Bypass

**[CRITICAL] Area 1d > Trial Bypass > _trendState defaults to access:true**
Riga/Funzione: L2638
Problema:
```js
const _trendState={access:true,mode:'trial',daysLeft:TRIAL_DAYS,_serverValidated:false};
```
Between page load and `initTrend()` completing its server check, the Trend section is fully accessible to anyone. The `_serverValidated:false` flag is **never checked** to restrict access. If `initTrend()` fails or is delayed (network issues, Supabase outage), access persists indefinitely.
Impatto: HIGH — Free Trend access for any user during the window before server validation completes. REGRESSED from documented fix.

**[CRITICAL] Area 1d > Trial Bypass > verify-subscription Edge Function NEVER called**
Riga/Funzione: L2669 (`checkTrendAccess`), L3429 (`pollTrendActivation`), L3288 (`syncUserAfterLogin`)
Problema: The `verify-subscription` Edge Function (205 lines) exists with JWT validation, rate limiting, SERVICE_ROLE_KEY, and CORS — but is **completely unused by the client**. All three functions bypass it with direct Supabase queries:
- `checkTrendAccess()` → `sb.from('users').select(...)` (L2673)
- `pollTrendActivation()` → `sb.from('users').select(...)` (L3445)
- `syncUserAfterLogin()` → `sb.from('users').upsert/select(...)` (L3305)

These queries depend solely on RLS policies. The server-side verification architecture is completely bypassed.
Impatto: HIGH — RLS may be insufficient if anon key has broader read access or policies are misconfigured. REGRESSED from documented fix.

**[HIGH] Area 1d > Trial Bypass > _checkTrendLocal trusts client timestamps**
Riga/Funzione: L2645 (`_checkTrendLocal`)
Problema: For anonymous users, trend access is determined entirely by client-side localStorage:
1. Delete `ik_trial_start` + `ik_trial_resets` → resets to fresh 7-day trial
2. Set `ik_trial_start` to future timestamp → passes `ts>Date.now()` check
3. Set `ik_trial_resets` to '0' → allows another reset cycle
4. Clear all localStorage → complete trial reset
Impatto: HIGH — Any user with dev tools knowledge can reset their trial indefinitely. REGRESSED from documented fix.

**[MEDIUM] Area 1d > Trial Bypass > setTrendAccess globally accessible**
Riga/Funzione: L2640
**[MEDIUM] Area 1d > Trial Bypass > setTrendAccess globally accessible**
Riga/Funzione: L2640
Problema: `trendAccess` Proxy logs warnings on direct set but `setTrendAccess()` is globally accessible. Attacker can call `setTrendAccess({access:true,mode:'paid',plan:'lifetime'})` from console.
Impatto: Medium — Console-accessible function grants full Trend access. The Proxy is cosmetic protection only.

---

## AREA 2: SUPABASE — DATABASE & RLS

### 2a. RLS on All Tables

**Users Table — RLS ENABLED**

| Policy | Type | Restriction | Status |
|--------|------|-------------|--------|
| `Users can read own row` | SELECT | `auth.uid() = id` | OK |
| `users_insert_own_safe` | INSERT | `auth.uid() = id AND trend_active = false AND COALESCE(referral_credit_cents, 0) = 0` | OK |
| `Users can update own non-billing fields` | UPDATE | Restricted — all billing columns must remain unchanged | OK |
| `Service role full access` | ALL | `auth.role() = 'service_role'` | SEE FINDING |

**[MEDIUM] Area 2a > RLS > `auth.role()` service_role policy is likely dead code**
Riga/Funzione: 20260416_users_rls.sql, policy `Service role full access`
Problema: `auth.role()` returns the role from JWT claims. When Supabase client libraries use the service_role key, they typically bypass RLS entirely at the Postgres level. This policy may never actually match, making it dead code.
Impatto: Medium — If RLS bypass via service_role key fails, Edge Functions relying on this policy would lose DB access. Conversely, if `auth.role()` returns `service_role` for a regular user JWT, full access is granted.

**referral_codes Table — RLS ENABLED**
- SELECT: owner only (`auth.uid() = user_id`)
- INSERT: owner only
- No UPDATE/DELETE for users

**referrals Table — RLS ENABLED**
- SELECT: owner (referrer or referred)
- No INSERT/UPDATE/DELETE for users (service_role only)

**payout_requests Table — RLS ENABLED**
- SELECT: owner only
- No INSERT/UPDATE/DELETE for users

**processed_events Table — RLS ENABLED**
- No user access (`USING false`, `WITH CHECK false`)

**payout_log Table — RLS ENABLED**
- SELECT: owner only, no user INSERT/UPDATE

**audit_log Table — RLS ENABLED**
- No user policies at all (service_role only)

**rate_limits Table — RLS ENABLED**
- No user policies (service_role only). Note: table exists but is never used by any Edge Function (all use in-memory Maps).

**[LOW] Area 2a > RLS > Duplicate idempotency tables**
Riga/Funzione: `processed_events` (20260408) vs `stripe_events_processed` (20260418)
Problema: Two tables exist for the same purpose (webhook idempotency). The webhook uses `processed_events`; the second table `stripe_events_processed` is never used.
Impatto: Low — Confusion and wasted storage.

**[LOW] Area 2a > RLS > Non-idempotent CREATE POLICY in migrations**
Riga/Funzione: 20260416_users_rls.sql
Problema: Bare `CREATE POLICY` would fail if the policy already exists. Not wrapped in `DO $$ IF NOT EXISTS`.
Impatto: Low — Migration ordering typically prevents this, but non-idempotent DDL is fragile.

---

### 2b. Schema Integrity

**[HIGH] Area 2b > Trigger > email column not protected**
Riga/Funzione: `protect_billing_columns()` trigger (20260418_backend_hardening.sql L42-84)
Problema: The `email` column on `users` table is NOT protected by the BEFORE UPDATE trigger or the RLS UPDATE policy. A user could change their email in the `public.users` table to match another user's email. The Stripe webhook `checkout.session.completed` handler matches by email (L83: `.eq('email', email)`).
Impatto: HIGH — An attacker could set their email to match a paying user. When the paying user completes checkout, the webhook activates Trend on the attacker's account. Account hijacking vector via email collision.

**[HIGH] Area 2b > Trigger > service_role bypass check is fragile**
Riga/Funzione: `protect_billing_columns()` L46: `IF current_setting('request.jwt.claim.role', true) = 'service_role'`
Problema: The trigger checks `request.jwt.claim.role` to allow service_role bypass. For Supabase service_role key usage, the role in JWT claims may be `anon` while RLS is bypassed at the Postgres level. If the JWT claim role is NOT `service_role`, the trigger would block service_role operations too — breaking the webhook, checkout flow, and all subscription management.
Impatto: HIGH — If Supabase's internal role setting doesn't match the trigger's expectation, all billing operations break.

**[LOW] Area 2b > INSERT > plan column not restricted on INSERT**
Riga/Funzione: 20260418_backend_hardening.sql L103-108
Problema: INSERT policy checks `trend_active` and `referral_credit_cents` but not `plan`. A user could insert their row with `plan = 'lifetime'`.
Impatto: Low — `plan` alone doesn't grant access (`trend_active` must be true, which IS blocked). Frontend might display plan-based UI incorrectly.

---

### 2c. Edge Function Security

**JWT Verification Patterns across Edge Functions:**

| Edge Function | JWT Verification | Assessment |
|---------------|-----------------|------------|
| `verify-subscription` | `anonClient.auth.getUser(token)` | CORRECT |
| `create-portal-session` | `authClient.auth.getUser()` | CORRECT |
| `create-checkout-session` | `supabase.auth.getUser()` via service_role + user JWT in global headers | WORKS but non-standard |
| `request-payout` | `sb.auth.getUser(token)` via service_role | CORRECT |
| `generate-referral-code` | `sb.auth.getUser(token)` via service_role | CORRECT |
| `connect-onboard` | `sb.auth.getUser(token)` via service_role | CORRECT |
| `delete-account` | `sb.auth.getUser(token)` via service_role | CORRECT |
| `stripe-webhook` | Stripe signature verification (no user JWT) | CORRECT — webhook uses Stripe sig |

**[MEDIUM] Area 2c > EF Security > Inconsistent JWT verification patterns**
Riga/Funzione: `create-checkout-session/index.ts` L71-80
Problema: `create-checkout-session` creates a service_role client with user's JWT in global headers, then calls `supabase.auth.getUser()`. While this works, it's a non-standard pattern that could lead to confusion. All other EFs use either a separate anon client or pass the token explicitly to `getUser(token)`.
Impatto: Medium — Non-standard pattern increases maintenance risk and could behave unexpectedly if Supabase SDK internals change.

**[LOW] Area 2c > EF Security > stripe-webhook uses deprecated serve() import**
Riga/Funzione: `stripe-webhook/index.ts` L1
Problema: Uses `import { serve } from 'https://deno.land/std@0.168.0/http/function.ts'` instead of `Deno.serve()`. All other EFs use `Deno.serve()`.
Impatto: Low — Deprecated API may be removed in future Deno versions. Functional today.

---

## AREA 3: STRIPE — PAGAMENTI & SUBSCRIPTIONS

### 3a. Checkout Flow

**[OK] create-checkout-session security verified:**
- JWT verification via service_role client ✅
- Rate limiting: 5 req/min per user ✅
- Plan validation with sanitization ✅
- Referral code sanitized: `replace(/[^A-Za-z0-9-]/g, '').substring(0, 32)` ✅
- Anti-self-referral check ✅
- Idempotency key: `checkout_${user.id}_${plan}` ✅
- Generic error messages (no internal info leakage) ✅
- CORS: ALLOWED_ORIGINS whitelist with origin reflection ✅

### 3b. Webhook

**[OK] stripe-webhook security verified:**
- Stripe signature verification via `constructEvent()` ✅
- Idempotency guard via `processed_events` table with UNIQUE constraint ✅
- Grace period handling (48h on payment_failed and subscription.deleted) ✅
- Anti-self-referral protection ✅
- Referral credit cap at 50,000 cents (EUR 500) ✅
- Double-reward prevention ✅

**[MEDIUM] Area 3b > Webhook > Referral credit cap implemented in JS, not SQL**
Riga/Funzione: stripe-webhook/index.ts L127-150
Problema: The referral credit cap (EUR 500) is implemented in JavaScript code (`if (currentCredits >= 50000)`) rather than relying on the SQL `LEAST()` function from migration `20260415_referral_credit_cap.sql`. Both layers exist, but if the SQL function `add_referral_credit()` is called from a different path (e.g., a future Edge Function), it also caps at 50000. The dual implementation is good defense-in-depth but creates maintenance burden.
Impatto: Medium — If either layer is modified without updating the other, the cap could be bypassed or become inconsistent.

### 3c. Stripe Connect

**[OK] request-payout security verified:**
- JWT verification ✅
- Rate limiting: 3 req/min per user ✅
- Minimum payout EUR 20 enforced server-side (`MIN_PAYOUT_CENTS = 2000`) ✅
- Stripe Connect onboarding verification ✅
- Payout via `consume_referral_credit()` SQL function ✅
- payout_log insertion after successful transfer ✅
- audit_log insertion ✅

**[LOW] Area 3c > Stripe Connect > No atomicity between transfer and DB update**
Riga/Funzione: request-payout/index.ts L80-120
Problema: The payout flow performs Stripe transfer first, then updates the DB. If the DB update fails after the transfer succeeds, the user's credit is consumed on the DB side but the Stripe transfer has already been sent. The `consume_referral_credit()` SQL function deducts the amount, so on retry the user wouldn't have enough credits. Manual intervention required.
Impatto: Low — Edge case requiring manual reconciliation. Mitigated by payout_log providing audit trail.

---

## AREA 4: BOOT SEQUENCE & AUTH STATE

### 4a. Race Conditions

**[OK] Boot double-guard pattern implemented:**
Lines 10609-10612: `if(_booted) return; _booted=true;` pattern prevents double-boot. ✅

**[MEDIUM] Area 4a > Boot > Watchdog resets booted=false**
Riga/Funzione: L10704
Problema: The watchdog timer resets `booted=false` to allow re-boot attempts. If the boot sequence is still in progress when the watchdog fires (e.g., slow network), it could trigger a second boot attempt, causing duplicate renders and race conditions.
Impatto: Medium — Could cause duplicate renders, flash of incorrect content, or stale data overwrites during slow network conditions.

**[LOW] Area 4a > Boot > _prefetchSession fire-and-forget races with boot**
Riga/Funzione: L3082
Problema: `_prefetchSession` runs as a fire-and-forget async call during early boot. It can complete at any point during the boot sequence, potentially causing auth state changes that interfere with the boot flow.
Impatto: Low — Mitigated by the double-guard pattern, but transient state inconsistencies possible.

### 4b. OAuth Redirect Loop

**[OK] ik_auth_origin cleanup implemented:**
- Set at L3178 (checkout), L3260 (post_onboarding) ✅
- Cleared at L3332-3334, L3359-3365 ✅
- Fallback route handled at L3358 ✅

**[MEDIUM] Area 4b > OAuth > signInWithGoogle missing explicit redirectTo**
Riga/Funzione: L3253 (`signInWithGoogle`)
Problema: `sb.auth.signInWithOAuth({provider:'google'})` does not specify `redirectTo` parameter. Relies entirely on Supabase dashboard config for allowed redirect URLs. If allowed redirect URLs are misconfigured in Supabase, tokens could redirect to an attacker-controlled domain.
Impatto: Medium — Open redirect vulnerability if Supabase auth config is misconfigured. Client code should explicitly set `redirectTo` to the known production URL.

**[LOW] Area 4b > OAuth > Stale ik_auth_origin on auth failure**
Riga/Funzione: L3355-3365
Problema: If auth fails after setting `ik_auth_origin` (e.g., user cancels Google OAuth), the value persists in localStorage. On next page load, `_resumePostOnboardingOrBoot()` reads it and may trigger incorrect flows.
Impatto: Low — Handled by the auth gate flow, but could cause brief incorrect UI state.

### 4c. Post-login State

**[OK] SIGNED_OUT handler implemented:**
Lines 3325-3329: Clears trendAccess, updates badge, nulls `_cachedSession`. ✅

**[OK] _cachedSession invalidation on SIGNED_OUT:**
Line 3328: `_cachedSession=null;` ✅

**[OK] Cross-tab session sync via Supabase broadcast:**
`onAuthStateChange` fires `SIGNED_OUT` across all tabs. ✅

---

## AREA 5: STORAGE & STATO LOCALE

### 5a. localStorage Robustness

**[OK] Most localStorage writes are wrapped in try/catch:**
Supabase client init (L2635), user data (L3293-3294), notification prefs (L9709, 9729), trial start (L2653-2654) — all wrapped. ✅

**[HIGH] Area 5a > KEEP_PREFIX mismatch — GDPR/Lang prefs wiped on logout**
Riga/Funzione: L8910, `const KEEP_PREFIX=['ikgdpr','iklang','iknotif']`
Problema: The KEEP_PREFIX values do NOT match the actual localStorage keys:
- `ik_gdpr_consent`.startsWith(`ikgdpr`) = **FALSE** → GDPR consent wiped on logout
- `ik_lang`.startsWith(`iklang`) = **FALSE** → Language preference wiped on logout
- `ik_notif_perm`.startsWith(`iknotif`) = **TRUE** → Notification prefs preserved ✅

Only notification prefs survive. GDPR consent and language preference are wiped on every logout/account deletion.
Impatto: HIGH — Logout wipes GDPR consent (legal violation — consent records must be retained), resets language to Italian default. GDPR compliance issue.

**[MEDIUM] Area 5a > clearAppData forEach not wrapped in try/catch**
Riga/Funzione: L8919
Problema: The entire `Object.keys(localStorage).forEach(...)` block is not wrapped in try/catch. If localStorage throws (Safari private mode, quota exceeded, storage corrupted), the function crashes without completing signOut.
Impatto: Medium — On Safari in private browsing, logout could fail silently, leaving user in an inconsistent state.

### 5b. Key Consistency

**[OK] Key naming is consistent:**
- `SK.*` constants for diet data (L5455-5457)
- `ik_*` prefix for app state (ik_lang, ik_gdpr_consent, ik_user_name, etc.)
- `ik_sb_session` for Supabase auth session
No orphaned or conflicting key patterns found. ✅

### 5c. Schema Validation

**[LOW] Area 5c > Schema > No version field on dietData**
Riga/Funzione: SK constants (L5455-5457)
Problema: The `dietData` object stored in localStorage has no version field. If the schema changes between app versions, old data would be loaded without migration, potentially causing runtime errors.
Impatto: Low — Current schema is stable, but future changes could break backward compatibility.

---

## AREA 6: SERVICE WORKER & PWA

### 6a. Cache Strategy

**[OK] External resources NOT intercepted:**
sw.js L53: `if (url.origin !== self.location.origin) return;` — external fonts, CDN, Supabase, Stripe all bypass the SW. ✅

**[OK] Navigation uses network-first with cache fallback:**
sw.js L59-78: `fetch(req)` with AbortController timeout (10s), fallback to cached `index.html`. ✅

**[OK] Static assets use stale-while-revalidate:**
sw.js L82-95: Return cached immediately, update cache in background. ✅

### 6b. Update Flow

**[OK] skipWaiting and clients.claim implemented:**
- L24: `self.skipWaiting()` on install ✅
- L34: `self.clients.claim()` on activate ✅
- L40-42: `SKIP_WAITING` message handler ✅

**[OK] Old caches cleaned on activate:**
L30-33: Deletes all caches except current version. ✅

**[MEDIUM] Area 6b > SW > No automated version bump mechanism**
Riga/Funzione: sw.js L13, CACHE constant
Problema: Cache version (`iron-kinetic-v27`) is a hardcoded string. There is no mechanism to auto-bump the version on deploy. If a developer forgets to bump the version, users may receive stale cached assets.
Impatto: Medium — Stale assets could cause inconsistent behavior after deployments. Requires manual discipline.

### 6c. Offline Behavior

**[OK] Offline fallback page exists:**
offline.html (12 lines) displays a simple offline message. ✅

**[LOW] Area 6c > Offline > offline.html hardcoded Italian only**
Riga/Funzione: offline.html L11
Problema: The offline page text is hardcoded Italian: `Sei offline. Riconnettiti per sincronizzare.` No i18n support.
Impatto: Low — English users see Italian text when offline. No functional impact.

**[OK] No data loss on offline:**
The SW does not intercept POST/PUT requests (L47: `if (req.method !== 'GET') return;`). All data-modifying operations go directly to the network. ✅

---

## Previously Fixed Issues — CONFIRMED WORKING

| Fix | Status | Evidence |
|-----|--------|----------|
| SIGNED_OUT handler in onAuthStateChange | CONFIRMED | L3325-3329 |
| URL token cleanup IIFE | CONFIRMED | L3419 |
| ik_trial_start removed from KEEP_PREFIX | CONFIRMED | L8910 |
| Boot double-guard pattern | CONFIRMED | L10609-10612 |
| CORS: ALLOWED_ORIGINS whitelist on all EFs | CONFIRMED | All EFs use origin reflection |
| Rate limiting via in-memory Map | CONFIRMED | All EFs have per-user rate limiting |
| Referral code sanitization | CONFIRMED | create-checkout-session L100 |
| Generic error messages in EFs | CONFIRMED | All catch blocks return generic errors |
| Stripe signature verification | CONFIRMED | stripe-webhook L50-57 |
| Idempotency guard | CONFIRMED | processed_events table + UNIQUE constraint |
| Anti-self-referral | CONFIRMED | webhook + checkout EF both check |
| Referral credit cap EUR 500 | CONFIRMED | JS + SQL dual layer |
| payout_log + audit_log tables | CONFIRMED | 20260418_p2_hardening.sql |
| delete-account EF for GDPR | CONFIRMED | 7 EFs verified |
| Security headers in server.js + serve.json | CONFIRMED | CSP, HSTS, X-Frame-Options DENY |

---

## Risk Score per Category

| Category | Risk Score (1-10) | Justification |
|----------|-------------------|---------------|
| 1. Client-Side Security | **9/10** | 3 CRITICAL regressions: trial bypass fully functional, server verification bypassed, optimistic access default |
| 2. Supabase/DB/RLS | **6/10** | RLS properly configured on all tables. email column unprotected. Trigger bypass check fragile |
| 3. Stripe/Payments | **3/10** | Well-implemented checkout, webhook, and payout flows. Minor dual-implementation maintenance issue |
| 4. Boot/Auth State | **4/10** | Solid SIGNED_OUT handling. Watchdog race and missing redirectTo are moderate risks |
| 5. Storage/State | **7/10** | KEEP_PREFIX mismatch is a GDPR compliance violation. clearAppData lacks error handling |
| 6. SW/PWA | **3/10** | Clean implementation. Minor offline.html i18n and manual version bump issues |

---

## Priority Matrix

### CRITICO — Fix Immediately

| # | Finding | Area | Impact |
|---|---------|------|--------|
| 1 | `_trendState` defaults `{access:true,mode:'trial'}` | 1d | Free premium access until server responds |
| 2 | `verify-subscription` EF never called by client | 1d | Server-side verification architecture bypassed |
| 3 | `_checkTrendLocal()` trusts localStorage timestamps | 1d | Unlimited trial resets via dev tools |

### ALTO — Fix This Week

| # | Finding | Area | Impact |
|---|---------|------|--------|
| 4 | email column unprotected in trigger/RLS | 2b | Account hijacking via email collision |
| 5 | KEEP_PREFIX mismatch wipes GDPR consent on logout | 5a | GDPR compliance violation |
| 6 | service_role trigger bypass check is fragile | 2b | All billing operations could break |
| 7 | setTrendAccess() globally accessible from console | 1d | Console grants full premium access |

### MEDIO — Fix Next Sprint

| # | Finding | Area | Impact |
|---|---------|------|--------|
| 8 | onAuthStateChange race condition | 1c | Duplicate async calls, transient UI glitches |
| 9 | Watchdog resets booted=false during boot | 4a | Double boot on slow networks |
| 10 | signInWithGoogle missing explicit redirectTo | 4b | Open redirect if Supabase misconfigured |
| 11 | clearAppData forEach not in try/catch | 5a | Logout fails on Safari private mode |
| 12 | Inconsistent JWT verification in checkout EF | 2c | Maintenance risk, non-standard pattern |
| 13 | Referral credit cap dual implementation | 3b | Maintenance burden, inconsistency risk |
| 14 | SW version not auto-bumped | 6b | Stale assets after deploy |
| 15 | auth.role() service_role policy dead code | 2a | Potential unexpected access or failure |
| 16 | ik_user_name/avatar not cleared on SIGNED_OUT | 4c | Identity confusion on shared devices |
| 17 | Avatar URL not validated before img.src | 1b | Low XSS risk via localStorage manipulation |

### BASSO — Backlog

| # | Finding | Area | Impact |
|---|---------|------|--------|
| 18 | Duplicate idempotency tables (processed_events + stripe_events_processed) | 2a | Confusion |
| 19 | Non-idempotent CREATE POLICY in 20260416 | 2a | Fragile migrations |
| 20 | plan column not restricted on INSERT | 2b | Cosmetic only |
| 21 | stripe-webhook uses deprecated serve() import | 2c | Future Deno compat |
| 22 | _prefetchSession fire-and-forget races with boot | 4a | Transient state |
| 23 | Stale ik_auth_origin on auth failure | 4b | Brief incorrect UI |
| 24 | No version field on dietData | 5c | Future compat risk |
| 25 | offline.html hardcoded Italian | 6c | EN users see IT text |
| 26 | Numeric innerHTML without sanitize | 1b | Theoretical XSS |

---

## Top 5 Business Risks

### 1. Revenue Loss from Trial Bypass (CRITICAL)
The entire server-side subscription verification architecture (verify-subscription Edge Function) exists but is **never called** by the client. Combined with `_trendState` defaulting to `{access:true}`, any user gets free Trend access from page load until the server check completes — and if the check fails, access persists indefinitely. Anonymous users can reset their trial unlimited times via localStorage. Estimated revenue impact: users bypassing the paywall entirely.

### 2. Account Hijacking via Email Collision (HIGH)
The `email` column on the `users` table is not protected by the BEFORE UPDATE trigger. An attacker can change their email to match a paying user. When the paying user completes checkout, the webhook matches by email and activates Trend on the attacker's account. This is an account takeover vector that requires no special tools beyond the Supabase client.

### 3. GDPR Non-Compliance (HIGH)
The `KEEP_PREFIX` array uses incorrect prefixes that don't match actual localStorage keys. GDPR consent (`ik_gdpr_consent`) is wiped on every logout. Under GDPR, consent records must be retained for audit purposes. This is a compliance violation that could result in regulatory penalties.

### 4. Billing System Fragility (HIGH)
The `protect_billing_columns()` trigger relies on `current_setting('request.jwt.claim.role')` matching `'service_role'`. If Supabase's internal role handling changes or doesn't set this claim as expected, the trigger would block all billing operations — breaking subscription activation, renewals, grace periods, and refunds across all users.

### 5. Console-Based Paywall Bypass (MEDIUM)
The `setTrendAccess()` function is globally accessible from the browser console. While the Proxy on `trendAccess` provides a warning, calling `setTrendAccess({access:true,mode:'paid',plan:'lifetime'})` grants immediate full access. Combined with the `_trendState` default of `{access:true}`, the client-side protection is fundamentally broken.

---

## Recommended Fix Order

1. **Change `_trendState` default** to `{access:false,mode:'none'}` (1 line, L2638)
2. **Wire `checkTrendAccess()` to call verify-subscription EF** instead of direct Supabase query (modify L2669-2710)
3. **Change `_checkTrendLocal()`** to always return `{access:false}` (modify L2645-2662)
4. **Fix KEEP_PREFIX** to match actual keys: `['ik_gdpr_','ik_lang','ik_notif_']` (1 line, L8910)
5. **Add email to trigger protection** in `protect_billing_columns()` (1 SQL migration)
6. **Add `redirectTo`** to `signInWithOAuth()` call (1 line, L3253)
7. **Wrap setTrendAccess in closure** to prevent console access
8. **Wrap clearAppData forEach** in try/catch (L8919)
9. **Migrate stripe-webhook** from `serve()` to `Deno.serve()`
10. **Remove unused `stripe_events_processed` table**
