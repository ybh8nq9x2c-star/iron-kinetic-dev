# Iron Kinetic — Security Audit Report

**Date:** 2026-04-15  
**Auditor:** AgentZero (agentzero@ironkinetic.dev)  
**Scope:** Full source code audit of index.html (10,798 lines), 6 Supabase Edge Functions, server.js, sw.js, serve.json, .env files  
**Classification:** CONFIDENTIAL — contains sensitive security findings

---

## Executive Summary

The audit identified **3 CRITICAL**, **5 HIGH**, **6 MEDIUM**, and **4 LOW** severity findings, plus **5 informational positives**. The most urgent issues are:

1. **Stripe `sk_live` key and webhook secret stored in AgentZero memory** — accessible to any agent
2. **Railway auth tokens committed to git** in `.env.railway`
3. **CORS wildcard (`*`) on 3 Edge Functions** handling payouts and Stripe Connect
4. **Client-side paywall bypass** via localStorage manipulation for anonymous users
5. **CSP `unsafe-inline`** negates XSS protection (architectural requirement of single-file SPA)

**Overall Risk Rating: HIGH** — Immediate action required on CRITICAL and HIGH items.

---

## Findings Index

| # | Severity | Area | Finding |
|---|----------|------|--------|
| 01 | CRITICAL | Secrets | Stripe sk_live key and webhook secret in AgentZero memory |
| 02 | CRITICAL | Secrets | Railway auth tokens in committed .env.railway |
| 03 | CRITICAL | CSRF | CORS wildcard on payout/connect Edge Functions |
| 04 | HIGH | CSP | unsafe-inline in script-src disables XSS protection |
| 05 | HIGH | SRI | No Sub-Resource Integrity on Stripe.js and Sentry SDK |
| 06 | HIGH | Paywall | Anonymous paywall bypass via localStorage ik_trial_start |
| 07 | HIGH | Secrets | Hardcoded Stripe Price IDs as fallbacks in Edge Function |
| 08 | HIGH | CSRF | Mismatched CORS origin in connect-onboard (ironkinetic.app vs railway.app) |
| 09 | MEDIUM | XSS | 16+ innerHTML assignments without sanitize() |
| 10 | MEDIUM | Storage | Health data stored unencrypted in localStorage |
| 11 | MEDIUM | Headers | Missing HSTS header |
| 12 | MEDIUM | Info Leak | Error messages expose internal Stripe/backend details |
| 13 | MEDIUM | Info Leak | Webhook signature error message returned to caller |
| 14 | MEDIUM | Storage | User email and avatar cached in localStorage |
| 15 | LOW | Rate Limit | No rate limiting on Edge Functions |
| 16 | LOW | Auth | Session tokens handled entirely client-side |
| 17 | LOW | Config | Sentry public key exposed in script tag |
| 18 | LOW | Config | Stripe publishable key is pk_live (expected but notable) |
| P1 | INFO | Positive | Webhook signature verification properly implemented |
| P2 | INFO | Positive | RLS hardening prevents client-side billing column manipulation |
| P3 | INFO | Positive | BEFORE UPDATE trigger as belt-and-suspenders billing protection |
| P4 | INFO | Positive | Webhook idempotency guard prevents double-processing |
| P5 | INFO | Positive | Anti-self-referral protection in checkout flow |

---

## Detailed Findings

### FINDING 01 — Stripe sk_live Key and Webhook Secret in AgentZero Memory

| Field | Value |
|-------|-------|
| **Severity** | CRITICAL |
| **Area** | Hardcoded Secrets |
| **Location** | AgentZero memory system (persistent `.a0proj/memory/` files) |
| **CVSS** | 9.1 |

**Description:** The following secrets are stored in AgentZero's persistent memory system and are accessible to any agent interacting with the project:

- Stripe live secret key: `sk_live_51TJVZ2JYTPcSrsvt...`
- Stripe webhook secret: `whsec_uRwOTgg...`
- Supabase platform token: `sbp_771bd4864b0d43d0dd9f747f02a5bcf7c8e8d80a`
- Supabase project ref: `qfmyhgrrkshcqxrwbyle`

These are NOT in the source code itself — they are in the AgentZero memory exports (`.a0proj/memory/embedding.json`, `.a0proj/memory/knowledge_import.json`) which persist across conversations.

**Impact:** Full administrative access to Stripe account — ability to create charges, issue refunds, access customer PII, modify subscriptions, and create arbitrary payouts. Supabase platform token grants project-level admin access including database, auth, and storage.

**Fix:**
1. **IMMEDIATELY ROTATE** the Stripe secret key in Stripe Dashboard → Developers → API Keys
2. **IMMEDIATELY ROTATE** the Stripe webhook endpoint secret in Stripe Dashboard → Developers → Webhooks
3. **IMMEDIATELY ROTATE** the Supabase platform token in Supabase Dashboard → Account → Access Tokens
4. Delete these secrets from AgentZero memory using `memory_forget` for each secret pattern
5. Store secrets ONLY in Supabase Edge Function environment (Deno.env) — never in notes, memory, or chat
6. Add `.a0proj/memory/` to `.gitignore` if not already present

---

### FINDING 02 — Railway Auth Tokens Committed to Git

| Field | Value |
|-------|-------|
| **Severity** | CRITICAL |
| **Area** | Hardcoded Secrets |
| **Location** | `.env.railway` (committed to repository root) |
| **CVSS** | 8.6 |

**Description:** The file `.env.railway` is committed to the git repository and contains:
```
RAILWAY_OACS=rlwy_oacs_9b88447ddb16bec32ea3d7828fffc865858cae57
RAILWAY_OACI=rlwy_oaci_5bDWepCktaniQrBppPi9N6qI
```
These are Railway authentication credentials (OAuth Access Token Secret and OAuth Access Token ID) that grant deployment and infrastructure management access.

**Impact:** Anyone with repository access can deploy to the Railway infrastructure, modify environment variables (including Stripe keys), change build configuration, or take down production. If the repository is ever made public, the infrastructure is fully compromised.

**Fix:**
1. **IMMEDIATELY ROTATE** both Railway tokens in Railway Dashboard → Account Settings → API Tokens
2. Verify `.env.railway` is in `.gitignore`
3. Remove from git history:
```bash
git filter-branch --force --index-filter 'git rm --cached .env.railway' --prune-empty HEAD
```
4. Force-push the cleaned history: `git push origin --force --all`

---

### FINDING 03 — CORS Wildcard on Payout/Connect Edge Functions

| Field | Value |
|-------|-------|
| **Severity** | CRITICAL |
| **Area** | CSRF Exposure |
| **Location** | `supabase/functions/request-payout/index.ts:5`, `supabase/functions/connect-onboard/index.ts:5`, `supabase/functions/generate-referral-code/index.ts:4` |
| **CVSS** | 8.1 |

**Description:** Three Edge Functions use `Access-Control-Allow-Origin: '*'`, allowing ANY website to make authenticated cross-origin requests:

```typescript
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',  // ← ANY origin allowed
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
```

This affects:
- **`request-payout`** — triggers real Stripe money transfers
- **`connect-onboard`** — creates Stripe Connect accounts and returns onboarding URLs
- **`generate-referral-code`** — returns referral codes and credit balances

By contrast, `create-checkout-session` and `create-portal-session` correctly restrict to `https://irokninetic-production.up.railway.app`.

**Impact:** A malicious website can trick an authenticated user's browser into:
- Requesting payouts to the attacker's Stripe Connect account (direct financial theft)
- Creating Stripe Connect accounts linked to the attacker
- Harvesting referral codes and credit balances

While JWT `Authorization` headers are required, CSRF attacks exploit the browser's automatic credential sending. An attacker site can craft a fetch with the victim's active session cookie or leverage an XSS to steal the JWT from localStorage.

**Fix:**
Replace `'*'` with the actual production origin in all three functions:
```typescript
const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://irokninetic-production.up.railway.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
```
For multi-environment support, use an environment variable:
```typescript
const ALLOWED_ORIGINS = [
  'https://irokninetic-production.up.railway.app',
  'https://iron-kinetic.app',
  Deno.env.get('DEV_ORIGIN') ?? '',
].filter(Boolean);

function getCorsOrigin(req: Request): string {
  const origin = req.headers.get('origin') ?? '';
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}
```

---

### FINDING 04 — CSP unsafe-inline Disables XSS Protection

| Field | Value |
|-------|-------|
| **Severity** | HIGH |
| **Area** | Content Security Policy |
| **Location** | `serve.json:8` |
| **CVSS** | 7.5 |

**Description:** The CSP includes `'unsafe-inline'` in `script-src`:
```
script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://js.stripe.com https://js-de.sentry-cdn.com;
```

This is an **architectural requirement** of the single-file SPA: index.html contains all JS inline (~8,000+ lines), and there are **259 inline `onclick` event handlers** in the HTML. Without `unsafe-inline`, the app renders as a black screen.

**Impact:** Any successful XSS injection completely bypasses CSP. Combined with Finding 09 (16+ unsanitized innerHTML assignments), a single injection vector leads to full code execution in the user's browser context — with access to auth tokens, health data, and payment flows.

**Fix (long-term — requires significant refactor):**
1. Extract all inline JS to external file(s) — `/js/app.js` etc.
2. Replace all 259 inline `onclick="fn()"` handlers with `addEventListener()` calls
3. Implement nonce-based CSP: `script-src 'self' 'nonce-<random>' ...`
4. Estimated effort: 40-80 hours

**Fix (short-term mitigation):**
1. Ensure ALL `innerHTML` assignments use `sanitize()` (see Finding 09)
2. Add input validation before any DOM insertion
3. Enforce CSP in report-only mode first to catch violations

---

### FINDING 05 — No Sub-Resource Integrity on Stripe.js and Sentry SDK

| Field | Value |
|-------|-------|
| **Severity** | HIGH |
| **Area** | Supply Chain / CSP |
| **Location** | `index.html:930-932` |
| **CVSS** | 7.2 |

**Description:** Only the Supabase SDK has SRI:
```html
<!-- Has SRI (safe) -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4"
        integrity="sha384-2zrRDgDHSYB/GN3nFW3fsZXoxEhKIr3N2h63Tc6DEOB9JJdFIu8xMJT2Cph/gBil"
        crossorigin="anonymous"></script>

<!-- NO SRI (vulnerable) -->
<script defer src="https://js.stripe.com/v3/" crossorigin="anonymous"></script>
<script src="https://js-de.sentry-cdn.com/53415d8991f07ae380ca333e9e7aabee.min.js"
        crossorigin="anonymous"></script>
```

**Impact:** If Stripe's or Sentry's CDN is compromised, or a man-in-the-middle attack replaces the script, arbitrary code executes in the app context with full access to localStorage data, auth tokens, and payment flows.

**Fix:**
1. Generate SRI hashes for each resource:
```bash
curl -s https://js.stripe.com/v3/ | openssl dgst -sha384 -binary | openssl base64 -A
curl -s https://js-de.sentry-cdn.com/53415d8991f07ae380ca333e9e7aabee.min.js | openssl dgst -sha384 -binary | openssl base64 -A
```
2. Add `integrity` attributes:
```html
<script defer src="https://js.stripe.com/v3/" integrity="sha384-<hash>" crossorigin="anonymous"></script>
```
3. **Note:** Stripe.js loads additional sub-resources dynamically which cannot be covered by SRI. This is a known limitation of Stripe's JS SDK. The CSP `frame-src` and `connect-src` restrictions partially mitigate this.

---

### FINDING 06 — Anonymous Paywall Bypass via localStorage

| Field | Value |
|-------|-------|
| **Severity** | HIGH |
| **Area** | Client-Side Paywall Bypass |
| **Location** | `index.html:2436-2452` (_checkTrendLocal function), `index.html:2437` (ik_trial_start) |
| **CVSS** | 7.0 |

**Description:** The `_checkTrendLocal()` function controls trial access for anonymous users entirely client-side:

```javascript
function _checkTrendLocal(){
  let stored=localStorage.getItem('ik_trial_start');
  const ts=parseInt(stored,10);
  if(!stored||isNaN(ts)||ts>Date.now()){
    localStorage.setItem('ik_trial_start',String(Date.now()));
    return{access:true,mode:'trial',daysLeft:TRIAL_DAYS};
  }
  const elapsed=(Date.now()-ts)/86400000;
  const left=Math.max(0,TRIAL_DAYS-elapsed);
  if(left<=0)return{access:false,mode:'expired'};
  return{access:true,mode:'trial',daysLeft:Math.ceil(left)};
}
```

An anonymous user can open DevTools and run:
```javascript
localStorage.setItem('ik_trial_start', String(Date.now()));
location.reload();
// Trial resets to 7 full days — unlimited repeats
```

This bypass is **unlimited** — users can repeat it indefinitely. Additionally, when the server-side `checkTrendAccess()` encounters ANY error (network, RLS, etc.), it falls back to `_checkTrendLocal()`, meaning intermittent server issues effectively grant unlimited trial access.

**Impact:** Anonymous users get unlimited free access to premium Trend features by manipulating a single localStorage key.

**Fix:**
1. **Server-side trial tracking** — store trial start timestamp in Supabase even for anonymous users (use a device fingerprint hash or install-specific UUID stored on first launch)
2. **Limit fallback behavior** — cache the last known server result; don't reset to fresh trial on error
3. **Encrypt localStorage timestamp** — sign the value with an HMAC using a server-rotated secret; validate on each check
4. **Short-term mitigation** — add a max trial reset count in localStorage (easily bypassed but raises the bar)

---

### FINDING 07 — Hardcoded Stripe Price IDs in Edge Function

| Field | Value |
|-------|-------|
| **Severity** | HIGH |
| **Area** | Hardcoded Secrets |
| **Location** | `supabase/functions/create-checkout-session/index.ts:106-108` |
| **CVSS** | 6.5 |

**Description:** Stripe Price IDs are hardcoded as fallback values in the checkout Edge Function:
```typescript
const priceMap: Record<string, string> = {
  monthly:  Deno.env.get('STRIPE_PRICE_MONTHLY')  ?? 'price_1TLJO9JYTPcSrsvtFVhrRBAT',
  annual:   Deno.env.get('STRIPE_PRICE_ANNUAL')   ?? 'price_1TLJO9JYTPcSrsvts1UjmFlr',
  lifetime: Deno.env.get('STRIPE_PRICE_LIFETIME') ?? 'price_1TLJO9JYTPcSrsvtvdSkbwGr',
```

**Impact:** If environment variables are not set, the function silently uses hardcoded live price IDs. This creates hidden coupling — price changes in Stripe require code changes. The price IDs also reveal the Stripe account structure to anyone with repo access.

**Fix:**
1. Remove fallback values — fail loudly if env vars are missing:
```typescript
const priceMap: Record<string, string> = {
  monthly:  Deno.env.get('STRIPE_PRICE_MONTHLY')  ?? (() => { throw new Error('STRIPE_PRICE_MONTHLY not set') })(),
  annual:   Deno.env.get('STRIPE_PRICE_ANNUAL')   ?? (() => { throw new Error('STRIPE_PRICE_ANNUAL not set') })(),
  lifetime: Deno.env.get('STRIPE_PRICE_LIFETIME') ?? (() => { throw new Error('STRIPE_PRICE_LIFETIME not set') })(),
}
```
2. Verify all three `STRIPE_PRICE_*` env vars are set in Supabase Edge Function secrets

---

### FINDING 08 — Mismatched CORS Origin in connect-onboard

| Field | Value |
|-------|-------|
| **Severity** | HIGH |
| **Area** | CSRF / Configuration |
| **Location** | `supabase/functions/connect-onboard/index.ts:61-62` |
| **CVSS** | 6.1 |

**Description:** The `connect-onboard` function hardcodes `ironkinetic.app` for Stripe Connect redirect URLs but uses CORS wildcard `*` (see Finding 03). Meanwhile, the actual production origin is `irokninetic-production.up.railway.app`.

```typescript
const accountLink = await stripe.accountLinks.create({
  account: accountId,
  refresh_url: 'https://ironkinetic.app?connect=refresh',
  return_url:  'https://ironkinetic.app?connect=success',
  type: 'account_onboarding'
})
```

This mismatch means:
- If `ironkinetic.app` is not properly configured as a custom domain, users are redirected to a non-functional URL after Stripe Connect onboarding
- The CORS `*` allows any origin to call this function, while redirects go to a different domain

**Impact:** Stripe Connect onboarding may fail silently. Combined with CORS wildcard, this creates a confusing attack surface.

**Fix:**
1. Use environment variable for all URLs:
```typescript
const APP_URL = Deno.env.get('APP_URL') ?? 'https://irokninetic-production.up.railway.app';
// ...
refresh_url: `${APP_URL}?connect=refresh`,
return_url:  `${APP_URL}?connect=success`,
```
2. Ensure `ironkinetic.app` is properly configured as a custom domain pointing to Railway

---

### FINDING 09 — 16+ innerHTML Assignments Without sanitize()

| Field | Value |
|-------|-------|
| **Severity** | MEDIUM |
| **Area** | XSS Vectors |
| **Location** | `index.html` — lines 2546, 2589, 2617, 2638, 2656, 4579, 4694, 5144-5149, 5564, 5847, 7519, 7618, 8250, 9133, 9447, 10147 |
| **CVSS** | 5.3 |

**Description:** A `sanitize()` function exists (line 3268) and is used in ~10 locations. However, **16+ innerHTML assignments do not use it**, including:

| Line | Context | User-controlled data? |
|------|---------|----------------------|
| 2546-2656 | Subscription CTA buttons (`ctaWrap.innerHTML`) | i18n strings (static) |
| 4579 | Help features (`_HELP_FEATURES.map`) | Static array |
| 4694 | Email contact text | i18n string |
| 5144-5149 | PWA install instructions | i18n strings (static) |
| 5564 | Meal plan grid | Meal names from plan engine |
| 5847 | 7-day bar chart | Check-in data from localStorage |
| 7519 | Meal preview | Generated HTML from plan engine |
| 7618 | Lock banner | Static text |
| 8250 | Badge notification | `sanitize(msg)` ✓ — safe |
| 9133 | Shopping list | Generated from plan data |
| 9447 | Calendar view | Generated from check-in data |
| 10147 | Text to `<br>` conversion | `el.textContent.replace` — text only |

The app also has **1 `insertAdjacentHTML`** at line 8172 (history log entries).

**Impact:** Most of these use static i18n strings or internally-generated HTML, which limits the attack surface. However, meal plan data (line 5564, 7519, 9133) and check-in data (line 5847, 9447) originate from localStorage — if localStorage is poisoned (via XSS or DevTools), stored XSS is possible.

**Fix:**
1. Wrap ALL innerHTML assignments with `sanitize()` or use `textContent` where HTML formatting is not needed
2. For complex HTML templates, use a safe template approach:
```javascript
// Instead of: el.innerHTML = `<div>${userInput}</div>`
// Use: el.textContent = userInput  (for text-only)
// Or: el.innerHTML = sanitize(template)  (for formatted content)
```
3. The `insertAdjacentHTML` at line 8172 also needs sanitization

---

### FINDING 10 — Health Data Stored Unencrypted in localStorage

| Field | Value |
|-------|-------|
| **Area** | localStorage Security |
| **Location** | `index.html` — all `localStorage.setItem(SK.*)` calls |
| **CVSS** | 5.5 |

**Description:** The following health and personal data is stored in plaintext in localStorage:

| localStorage Key | Data | Sensitivity |
|-----------------|------|------------|
| `ik_profile` | Age, sex, weight, body fat %, height, activity level | Health (GDPR special category) |
| `ik_checkins` | Daily check-ins: weight, hunger, mood, tag, notes | Health + behavioral |
| `ik_wLog` | Weight log history | Health |
| `ik_diet` | Diet plan, macros, phases, refeed schedule | Health |
| `ik_prefs` | User preferences, language | Personal |
| `ik_streaks` | Usage streaks | Behavioral |
| `ik_user_name` | Google display name | PII |
| `ik_user_avatar` | Google avatar URL | PII |
| `ik_trial_start` | Trial start timestamp | Business logic |

All data is readable by any script running in the page origin, browser extensions, and malicious iframes (if any).

**Impact:** Under GDPR, health data (weight, body fat, diet plans, check-in notes) is a special category requiring explicit consent and appropriate security measures. Plaintext localStorage does not constitute appropriate security. Any XSS (Finding 09) immediately exposes all health data.

**Fix:**
1. **Short-term:** Encrypt sensitive localStorage values using a per-session key derived from a user password or random key stored in a cookie with HttpOnly/Secure flags
2. **Medium-term:** For authenticated users, rely primarily on Supabase storage (already partially implemented via sync) — use localStorage only as an offline cache with encrypted values
3. **Privacy Policy alignment:** The current privacy policy (lines 1037, 4324) mentions localStorage for anonymous users but should explicitly note that data is stored in cleartext

---

### FINDING 11 — Missing HSTS Header

| Field | Value |
|-------|-------|
| **Severity** | MEDIUM |
| **Area** | Security Headers |
| **Location** | `serve.json` |
| **CVSS** | 5.3 |

**Description:** The `serve.json` includes good security headers (CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy) but is missing:
- **`Strict-Transport-Security`** (HSTS) — no enforcement of HTTPS
- **`Permissions-Policy`** — no restriction of browser APIs

**Impact:** Without HSTS, an attacker can perform SSL stripping on first visit. Users who type `ironkinetic.app` without `https://` may be redirected to an attacker-controlled HTTP site.

**Fix:**
Add to `serve.json`:
```json
{
  "key": "Strict-Transport-Security",
  "value": "max-age=63072000; includeSubDomains; preload"
},
{
  "key": "Permissions-Policy",
  "value": "camera=(), microphone=(), geolocation=()"
}
```

---

### FINDING 12 — Error Messages Expose Internal Details

| Field | Value |
|-------|-------|
| **Severity** | MEDIUM |
| **Area** | Information Disclosure |
| **Location** | `supabase/functions/connect-onboard/index.ts:72`, `supabase/functions/generate-referral-code/index.ts:72`, `supabase/functions/request-payout/index.ts:117` |
| **CVSS** | 4.3 |

**Description:** Multiple Edge Functions return raw `err.message` to the client:

```typescript
// connect-onboard/index.ts:72
return new Response(JSON.stringify({ error: err.message }), {
  status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
})

// request-payout/index.ts:117
return new Response(JSON.stringify({ error: err.message }), {
  status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
})
```

Additionally, `create-checkout-session` returns Stripe error messages to the client:
```typescript
if (msg.includes('No such price')) {
  return json({ error: `Price ID non trovato su Stripe (${priceId}).` }, 500)
}
return json({ error: `Errore Stripe: ${msg}` }, 500)
```

**Impact:** Error messages can reveal internal implementation details, Stripe API error patterns, Supabase table structure, and environment variable status. This aids attackers in understanding the backend architecture.

**Fix:**
1. Return generic error messages to the client:
```typescript
return new Response(JSON.stringify({ error: 'Internal server error' }), {
  status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
})
```
2. Log the full error server-side only (`console.error`)
3. For Stripe errors, return a generic message and log the details

---

### FINDING 13 — Webhook Signature Error Returned to Caller

| Field | Value |
|-------|-------|
| **Severity** | MEDIUM |
| **Area** | Information Disclosure |
| **Location** | `supabase/functions/stripe-webhook/index.ts:56-57` |
| **CVSS** | 4.3 |

**Description:** The Stripe webhook returns the signature verification error to the caller:
```typescript
try {
  event = stripe.webhooks.constructEvent(body, sig!, Deno.env.get('STRIPE_WEBHOOK_SECRET')!)
} catch (err) {
  console.error('Webhook signature error:', err.message)
  return new Response(`Webhook Error: ${err.message}`, { status: 400 })
}
```

**Impact:** An attacker sending malformed webhooks can learn about the signature verification process and error patterns. While this doesn't directly expose the webhook secret, it provides information about the verification implementation.

**Fix:**
Return a generic error:
```typescript
return new Response('Webhook signature verification failed', { status: 400 })
```

---

### FINDING 14 — User Email and Avatar Cached in localStorage

| Field | Value |
|-------|-------|
| **Severity** | MEDIUM |
| **Area** | localStorage Security |
| **Location** | `index.html:3102-3103` |
| **CVSS** | 4.0 |

**Description:** After Google sign-in, user data is cached in localStorage:
```javascript
if(googleName)try{localStorage.setItem('ik_user_name',googleName);}catch{}
if(googleAvatar)try{localStorage.setItem('ik_user_avatar',googleAvatar);}catch{}
```

**Impact:** PII (email, avatar URL) persists in localStorage indefinitely. Any XSS or browser extension can read this data. Combined with health data in localStorage (Finding 10), this creates a comprehensive user profile accessible to attackers.

**Fix:**
1. Store user display data in memory (JS variables) rather than localStorage
2. If persistence is needed for offline support, encrypt the values
3. Clear on logout

---

### FINDING 15 — No Rate Limiting on Edge Functions

| Field | Value |
|-------|-------|
| **Severity** | LOW |
| **Area** | DoS / Abuse |
| **Location** | All 6 Edge Functions |
| **CVSS** | 3.7 |

**Description:** None of the Edge Functions implement rate limiting. An attacker can:
- Flood `create-checkout-session` with requests to create orphaned Stripe checkout sessions
- Rapidly call `generate-referral-code` to enumerate referral codes
- Spam `request-payout` to trigger repeated Stripe API calls (which cost money)

Supabase Edge Functions have platform-level rate limits, but these are generous and shared across all functions.

**Impact:** Resource exhaustion, increased Stripe API costs, potential referral code enumeration.

**Fix:**
1. Implement per-user rate limiting using a Supabase table or Redis-like store:
```typescript
const { data: rateLimit } = await sb
  .from('rate_limits')
  .select('count, last_reset')
  .eq('user_id', user.id)
  .eq('action', 'checkout')
  .single();
if (rateLimit && rateLimit.count > 10 && Date.now() - rateLimit.last_reset < 3600000) {
  return json({ error: 'Too many requests' }, 429);
```
2. Set Stripe API call budgets
3. Add referral code generation cooldown

---

### FINDING 16 — Session Tokens Handled Entirely Client-Side

| Field | Value |
|-------|-------|
| **Severity** | LOW |
| **Area** | Auth Token Handling |
| **Location** | `index.html` — Supabase JS SDK manages tokens |
| **CVSS** | 3.1 |

**Description:** Auth tokens are managed entirely by the Supabase JS SDK on the client side:
- `access_token` is stored in localStorage by Supabase Auth SDK
- `refreshSession()` is called at lines 2838, 2864, 9570 to extend sessions
- `onAuthStateChange` at line 3130 handles session updates

This is the standard Supabase auth pattern for SPAs, but it means:
- Tokens are accessible to any JavaScript running in the page (XSS = token theft)
- Tokens are accessible to browser extensions
- No HttpOnly cookie protection

**Impact:** Any successful XSS leads to immediate auth token theft, enabling account takeover.

**Fix:**
1. This is inherent to the SPA + Supabase architecture — not easily fixable without server-side rendering
2. Mitigate by reducing XSS risk (Findings 04, 09)
3. Consider implementing Supabase's PKCE auth flow for additional protection
4. Short token lifetimes are already handled by Supabase default 1-hour access tokens

---

### FINDING 17 — Sentry Public Key Exposed in Script Tag

| Field | Value |
|-------|-------|
| **Severity** | LOW |
| **Area** | Configuration Exposure |
| **Location** | `index.html:932` |
| **CVSS** | 2.0 |

**Description:** The Sentry SDK loader URL contains a project-specific public key:
```html
<script src="https://js-de.sentry-cdn.com/53415d8991f07ae380ca333e9e7aabee.min.js"></script>
```

**Impact:** This is a public key used for the Sentry browser SDK — it is designed to be public and can only send events, not read them. Low risk but worth noting.

**Fix:** No action needed — this is expected for client-side error reporting. Ensure the Sentry project is configured to reject events from unauthorized domains in Sentry Project Settings → Client Keys.

---

### FINDING 18 — Stripe Publishable Key is pk_live

| Field | Value |
|-------|-------|
| **Severity** | LOW |
| **Area** | Configuration |
| **Location** | `index.html:2427` |
| **CVSS** | 2.0 |

**Description:** The Stripe publishable key is a live key:
```javascript
const STRIPE_PK='pk_live_51TJVZ2JYTPcSrsvtjpVbCEtvJFpC9pIj5n0PPOSPLtIGcQ12rc6YOHChFq5uaP7RZ63Gmeu1ZuQF806vWIW7b4EA007qCJNHGX';
```

Publishable keys are designed to be client-facing and cannot be used to create charges or access customer data. However, using `pk_live` means the key is tied to the production Stripe account.

**Impact:** Minimal — publishable keys are safe to expose. The key can only be used to initialize Stripe.js and create payment tokens. However, hardcoding it in source makes it harder to switch between test/live environments.

**Fix:**
1. Consider loading the key from a config endpoint or environment variable
2. No urgent action needed — this is the expected Stripe integration pattern

---

## Positive Security Controls

### POSITIVE 01 — Webhook Signature Verification

| Field | Value |
|-------|-------|
| **Location** | `supabase/functions/stripe-webhook/index.ts:33-39` |

The Stripe webhook properly verifies the `stripe-signature` header using `stripe.webhooks.constructEvent()` with the webhook secret. This prevents forgery of webhook events. ✅

---

### POSITIVE 02 — RLS Hardening Prevents Client-Side Billing Manipulation

| Field | Value |
|-------|-------|
| **Location** | `supabase/migrations/20260408_billing_rls_hardening.sql` |

Row Level Security policies prevent authenticated users from modifying billing columns (`trend_active`, `plan`, `stripe_customer_id`, `trial_end`, `grace_period_until`, etc.) on their own row. The UPDATE policy uses a `WITH CHECK` clause that compares each billing column against its current value, rejecting any changes. ✅

---

### POSITIVE 03 — BEFORE UPDATE Trigger as Belt-and-Suspenders

| Field | Value |
|-------|-------|
| **Location** | `supabase/migrations/20260408_billing_rls_hardening.sql:54-94` |

A `protect_billing_columns()` trigger function runs as `SECURITY DEFINER` and explicitly rejects any attempt to modify billing columns from non-`service_role` contexts. This provides defense-in-depth even if the RLS policy is accidentally weakened. ✅

---

### POSITIVE 04 — Webhook Idempotency Guard

| Field | Value |
|-------|-------|
| **Location** | `supabase/functions/stripe-webhook/index.ts:22-38` |

The `checkIdempotency()` helper inserts each event into a `processed_events` table. If a duplicate event arrives (23505 unique violation), it returns early without reprocessing. This prevents double-activation, double-credits, and double-payouts from Stripe retries. ✅

---

### POSITIVE 05 — Anti-Self-Referral Protection

| Field | Value |
|-------|-------|
| **Location** | `supabase/functions/stripe-webhook/index.ts:74-78`, `supabase/functions/create-checkout-session/index.ts:89-92` |

The referral system blocks self-referrals at two levels:
1. In the webhook: `if (codeRow.user_id === referredUserId)` check prevents crediting yourself
2. In the checkout: `if (!referrer || referrer.user_id === user.id)` check ignores self-referral codes

Additionally, double-reward protection checks for existing confirmed referrals before crediting. ✅

---

## Remediation Priority Matrix

| Priority | Finding | Effort | Impact |
|----------|---------|--------|--------|
| **P0 — Immediate** | 01: Rotate secrets from memory | 1 hour | Prevents Stripe account takeover |
| **P0 — Immediate** | 02: Rotate Railway tokens + git history clean | 2 hours | Prevents infrastructure takeover |
| **P0 — Immediate** | 03: Fix CORS wildcards | 30 min | Prevents CSRF financial attacks |
| **P1 — This week** | 05: Add SRI to CDN scripts | 1 hour | Prevents CDN supply chain attacks |
| **P1 — This week** | 06: Fix paywall bypass | 4-8 hours | Prevents revenue loss |
| **P1 — This week** | 07: Remove hardcoded price IDs | 30 min | Reduces secret surface area |
| **P1 — This week** | 08: Fix connect-onboard URLs | 30 min | Fixes onboarding flow |
| **P2 — This sprint** | 11: Add HSTS header | 15 min | Prevents SSL stripping |
| **P2 — This sprint** | 12-13: Sanitize error messages | 2 hours | Reduces info disclosure |
| **P3 — Next sprint** | 09: Wrap all innerHTML with sanitize() | 4-6 hours | Reduces XSS attack surface |
| **P3 — Next sprint** | 10: Encrypt health data in localStorage | 8-16 hours | GDPR compliance |
| **P3 — Next sprint** | 14: Move user data out of localStorage | 2-4 hours | Reduces PII exposure |
| **P4 — Backlog** | 04: Remove unsafe-inline (major refactor) | 40-80 hours | Full CSP enforcement |
| **P4 — Backlog** | 15: Add rate limiting | 4-8 hours | Prevents abuse |

---

## Scope & Methodology

This audit was performed using automated pattern matching (grep, regex) and manual code review of:
- `index.html` (10,798 lines) — full scan for secrets, XSS vectors, localStorage usage, auth handling, paywall logic
- `supabase/functions/` (6 Edge Functions) — CORS, auth, error handling, Stripe integration
- `server.js` — Express configuration, headers, caching
- `sw.js` — Service Worker fetch handling, cache strategy
- `serve.json` — CSP and security headers
- `.env.railway` — committed secrets
- `.a0proj/memory/` — persistent memory exports
- `supabase/migrations/` — RLS policies, triggers, schema design

**Not in scope:** Supabase RLS policy audit (beyond billing columns), third-party library vulnerabilities, infrastructure penetration testing, social engineering.

---

*End of Security Audit Report*
