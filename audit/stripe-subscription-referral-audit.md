# Iron Kinetic — Stripe, Subscription & Referral System Security Audit

**Date:** 2026-04-15  
**Auditor:** Agent Zero (Master Developer)  
**Scope:** Checkout flow, Stripe integration, subscription lifecycle, referral system, access control

**Files audited:**
- `index.html` (client-side billing logic, ~10,799 lines)
- `supabase/functions/stripe-webhook/index.ts` (289 lines)
- `supabase/functions/create-checkout-session/index.ts` (195 lines)
- `supabase/functions/create-portal-session/index.ts` (86 lines)
- `supabase/functions/request-payout/index.ts` (122 lines)
- `supabase/functions/generate-referral-code/index.ts` (77 lines)
- `supabase/functions/connect-onboard/index.ts` (77 lines)
- `supabase/migrations/20260408_billing_schema.sql` (193 lines)
- `supabase/migrations/20260408_billing_rls_hardening.sql` (84 lines)
- `supabase/migrations/20260413_referral_system.sql` (90 lines, **incomplete**)

---

## Executive Summary

The billing system has a **solid server-side foundation**: Stripe webhooks are idempotent, RLS policies are hardened with a trigger guard, referral credits are atomic, and the checkout flow correctly delegates to an Edge Function. However, **critical gaps** remain:

1. **Incomplete migration** — the referral system migration is truncated mid-statement, meaning RLS policies for `referral_codes`, `referrals`, and `payout_requests` are not applied.
2. **Client-side `trendAccess` bypass** — any user can open the browser console and override the global `trendAccess` variable to unlock paid features for the current session.
3. **Deprecated `redirectToCheckout` still present** — a dead-code path using the deprecated client-only Stripe checkout exists.
4. **No referral credit cap** — unlimited referral credit accumulation is possible.
5. **CORS wildcards** on three Edge Functions expose them to any origin.

---

## Domain 3: Checkout & Stripe Integration

### 3.1 [MEDIUM] Deprecated `redirectToCheckout` Still Present in Dead Code

| Field | Detail |
|-------|--------|
| **Severity** | MEDIUM |
| **Title** | `_clientSideCheckout()` uses deprecated `stripe.redirectToCheckout()` |
| **Location** | `index.html:2937–2996` |
| **Problem** | The function `_clientSideCheckout(plan, email)` calls `stripe.redirectToCheckout({ lineItems: [...] })` which is deprecated by Stripe and does **not work in live mode** without Stripe Connect. The code itself includes comments acknowledging this (lines 2940–2945, 2978–2981). While the primary checkout path (`_doStartCheckout`) correctly uses the Edge Function, this dead code remains callable. |
| **Impact** | If somehow invoked (e.g., fallback, future regression), users see cryptic Stripe errors instead of a working checkout. The deprecated API may be removed by Stripe at any time. |
| **Fix** | Remove `_clientSideCheckout()` entirely. The server-side checkout path via `create-checkout-session` Edge Function is the correct and only path. Verify no call sites reference this function. |

---

### 3.2 [INFO] Stripe Public Key Correctly Uses Live Mode

| Field | Detail |
|-------|--------|
| **Location** | `index.html:2427` |
| **Value** | `pk_live_51TJVZ2JYTPcSrsvt...` |
| **Finding** | The public key is correctly a `pk_live_` key, matching the production environment. The Edge Function also correctly warns if `sk_test_` is detected (create-checkout-session line 119–121). **No issue found.** |

---

### 3.3 [LOW] Hardcoded Price IDs in Client-Side Fallback Code

| Field | Detail |
|-------|--------|
| **Severity** | LOW |
| **Title** | Stripe Price IDs hardcoded in `_clientSideCheckout` |
| **Location** | `index.html:2962–2966` |
| **Problem** | The dead-code function `_clientSideCheckout` embeds Price IDs directly as a `priceMap` object. These match the server-side fallback defaults in `create-checkout-session` (lines 106–108), but if prices ever change, the client copies would become stale. |
| **Impact** | Low because the function is dead code and never called in the primary flow. Maintenance burden and potential confusion only. |
| **Fix** | Remove `_clientSideCheckout()` entirely (same fix as 3.1). |

---

### 3.4 [LOW] create-checkout-session Error Surfaces Stripe Messages to Client

| Field | Detail |
|-------|--------|
| **Location** | `supabase/functions/create-checkout-session/index.ts:193` |
| **Problem** | On generic Stripe errors, the raw error message is returned: `return json({ error: 'Errore Stripe: ' + msg }, 500)`. This could leak internal Stripe error details (e.g., account configuration issues) to the client. |
| **Impact** | Information disclosure — not exploitable for access, but may reveal backend configuration details. |
| **Fix** | Return a generic user-facing message and log the detailed error server-side only:
```typescript
console.error('[checkout] Stripe error:', msg)
return json({ error: 'Errore durante la creazione del checkout. Riprova.' }, 500)
```

---

### 3.5 [INFO] Success/Cancel URL Handling — No Tampering Risk

| Field | Detail |
|-------|--------|
| **Location** | `supabase/functions/create-checkout-session/index.ts:157–158`, `index.html:3211–3242` |
| **Finding** | The success URL is `${origin}/?trend=success`. The client-side handler at line 3211 does **not** grant access upon seeing `?trend=success` — it polls the Supabase `users` table for up to 60 seconds waiting for `trend_active=true` to be set by the webhook. A user cannot bypass payment by simply visiting `?trend=success`. **Well designed — no issue found.** |

---

### 3.6 [LOW] Race Condition Between Webhook and User Return — Handled But Imperfect

| Field | Detail |
|-------|--------|
| **Severity** | LOW |
| **Title** | Success polling has a maximum window; edge case of very delayed webhooks |
| **Location** | `index.html:3217–3238` |
| **Problem** | The client polls for 12 iterations × 5 seconds = 60 seconds. If the webhook is delayed beyond 60s (rare but possible during Stripe outages), the user sees "Payment still processing — refresh to check status". The `trendAccess` remains in the optimistic trial state during this window. |
| **Impact** | User confusion and potential support requests. Not a security issue — access is still gated by server-side `trend_active`. |
| **Fix** | Consider extending polling to 120s or adding a manual "Check again" button after timeout. This is a UX improvement, not a security fix. |

---

### 3.7 [INFO] trend_active Verified Server-Side — RLS Hardened

| Field | Detail |
|-------|--------|
| **Location** | `supabase/migrations/20260408_billing_rls_hardening.sql`, `stripe-webhook/index.ts` |
| **Finding** | The RLS hardening migration drops the broad "Users can update own row" policy and replaces it with a column-restricted policy that prevents users from modifying `trend_active`, `plan`, `stripe_customer_id`, `grace_period_until`, `trial_end`, etc. A `BEFORE UPDATE` trigger (`protect_billing_columns`) provides belt-and-suspenders protection, raising exceptions if non-service_role users attempt to change billing columns. **Excellent defense in depth — no issue found.** |

---

### 3.8 [INFO] create-portal-session Authenticated Properly

| Field | Detail |
|-------|--------|
| **Location** | `supabase/functions/create-portal-session/index.ts:24–67` |
| **Finding** | Uses dual-client authentication pattern: anon key + user JWT for identity verification, then service_role for DB lookup. The Stripe customer ID is retrieved server-side — not accepted from the client. The Billing Portal session is created with the verified customer ID. **Properly authenticated — no issue found.** |

---

## Domain 4: Referral System

### 4.1 [CRITICAL] Referral System Migration Truncated — RLS Policies Not Applied

| Field | Detail |
|-------|--------|
| **Severity** | CRITICAL |
| **Title** | `20260413_referral_system.sql` is incomplete — truncated at line 90 mid-DROP POLICY |
| **Location** | `supabase/migrations/20260413_referral_system.sql:89–90` |
| **Problem** | The migration ends abruptly with:
```sql
-- referral_codes: owner can see/manage their own code
DROP POLICY IF EXISTS
```
The migration enables RLS on `referral_codes`, `referrals`, and `payout_requests` (lines 85–87) but **never creates any RLS policies** for these tables. This means:
- All three tables have RLS enabled but **no policies granting access**
- Users cannot read their own referral codes or referral history via client SDK
- The service_role (used by Edge Functions) bypasses RLS, so server-side functions still work
- If any client-side code tries to query these tables directly, it will fail silently

Additionally, the migration does not define RLS for `referrals` or `payout_requests` tables at all. |
| **Impact** | Functional issues for referral UI. The security posture is correct (deny by default), but the intended owner-access policies are missing. This could also mask data visibility bugs. |
| **Fix** | Complete the migration with appropriate RLS policies:
```sql
CREATE POLICY "Users can read own referral code" ON referral_codes
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Referrers can read own referrals" ON referrals
  FOR SELECT USING (auth.uid() = referrer_id);

CREATE POLICY "Users can read own payouts" ON payout_requests
  FOR SELECT USING (auth.uid() = user_id);
```
Run the completed migration against the production database. |

---

### 4.2 [INFO] generate-referral-code Is Idempotent

| Field | Detail |
|-------|--------|
| **Location** | `supabase/functions/generate-referral-code/index.ts:24–41` |
| **Finding** | The function first checks for an existing code (line 24–28). If one exists, it returns it immediately. Only if no code exists does it attempt to generate a new one (with 5 retry attempts for collision). **Properly idempotent — no issue found.** |

---

### 4.3 [HIGH] No Cap on Referral Credits — Unlimited Accumulation Possible

| Field | Detail |
|-------|--------|
| **Severity** | HIGH |
| **Title** | No maximum cap on referral credit accumulation |
| **Location** | `supabase/functions/stripe-webhook/index.ts:94`, `supabase/migrations/20260413_referral_system.sql:50–58` (`add_referral_credit` function) |
| **Problem** | The referral credit system grants 10% of each referred user's payment amount with no upper limit. An attacker could:
1. Create multiple Stripe accounts with different emails
2. Use referral codes to sign up and pay for subscriptions
3. Accumulate unlimited credits (minimum €6.99/month → €0.70/referral)
4. Request payouts via Stripe Connect

The ROI is negative (pay €6.99 to earn €0.70), so direct profit exploitation is limited. However, combined with stolen payment methods or promotional pricing, it could be abused. |
| **Impact** | Potential for coordinated abuse at scale. Could inflate referral metrics and create payout processing overhead. |
| **Fix** | Add a maximum credit cap in the `add_referral_credit` SQL function:
```sql
CREATE OR REPLACE FUNCTION add_referral_credit(uid uuid, amount int)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE users
  SET referral_credit_cents = LEAST(COALESCE(referral_credit_cents, 0) + amount, 50000)
  WHERE id = uid;
$$;
```
Also consider a maximum number of confirmed referrals per referrer (e.g., 50). |

---

### 4.4 [INFO] Self-Referral Protection — Implemented in Two Places

| Field | Detail |
|-------|--------|
| **Location** | `supabase/functions/create-checkout-session/index.ts:88–101`, `supabase/functions/stripe-webhook/index.ts:104–105` |
| **Finding** | Self-referral is blocked in two places:
1. **At checkout creation** (line 95): if `referrer.user_id === user.id`, the referral code is cleared
2. **At webhook confirmation** (line 104): if `codeRow.user_id === referredUserId`, the reward is blocked

This double-check is excellent defense in depth. **No issue found.** |

---

### 4.5 [INFO] Minimum Payout Threshold Enforced Server-Side

| Field | Detail |
|-------|--------|
| **Location** | `supabase/functions/request-payout/index.ts:9,42–47` |
| **Finding** | The `MIN_PAYOUT_CENTS` constant (€20) is enforced in the Edge Function (line 42). Additionally, the `consume_referral_credit` SQL function (migration line 65–81) uses an atomic UPDATE with `WHERE referral_credit_cents >= min_cents`, providing TOCTOU protection. **Properly enforced — no issue found.** |

---

### 4.6 [MEDIUM] IdempotencyKey for Stripe Transfer Uses `Date.now()` — Not Truly Idempotent

| Field | Detail |
|-------|--------|
| **Severity** | MEDIUM |
| **Title** | Payout idempotency key includes `Date.now()` making it non-idempotent |
| **Location** | `supabase/functions/request-payout/index.ts:90` |
| **Problem** | The Stripe transfer uses:
```typescript
idempotencyKey: `payout_${user.id}_${Date.now()}`
```
Since `Date.now()` is always unique, this key provides **no idempotency protection**. If the function is called twice in rapid succession (e.g., double-click, network retry), two separate transfers will be created. The atomic credit consumption prevents the actual double-spend (the second call will get `null` from `consume_referral_credit`), but the idempotency key gives a false sense of safety. |
| **Impact** | In the current code, the atomic `consume_referral_credit` RPC prevents double-payout. However, the misleading idempotency key could confuse future maintainers into thinking the Stripe-level idempotency is active. |
| **Fix** | Use a deterministic key based on user ID only (since the atomic consume already prevents double-spend):
```typescript
idempotencyKey: `payout_${user.id}_${consumeResult}`
```
This makes the key truly idempotent for the same payout amount. |

---

### 4.7 [INFO] Stripe Connect Onboarding Is Resumable

| Field | Detail |
|-------|--------|
| **Location** | `supabase/functions/connect-onboard/index.ts:35–64` |
| **Finding** | The function handles three states:
1. **No account exists** → creates a new Express account and returns onboarding link
2. **Account exists but not onboarded** → creates a new `account_onboarding` link with `refresh_url` and `return_url`
3. **Account already onboarded** → returns a Stripe Express login link for dashboard access

The `refresh_url` is set to `https://ironkinetic.app?connect=refresh`, and the client-side handler at `index.html:9540` calls `_ikRefStartOnboarding()` again, effectively resuming. **Properly resumable — no issue found.** |

---

### 4.8 [LOW] confirmed_referrals Count May Not Match Actual Paid Conversions

| Field | Detail |
|-------|--------|
| **Location** | `supabase/functions/generate-referral-code/index.ts:54–58` |
| **Problem** | The `confirmed_referrals` count queries `referrals` table with `status='confirmed'`. A referral is set to `confirmed` in the webhook on `checkout.session.completed` (line 117). However, if a referred user later refunds or disputes the charge, the referral status is **not** updated to `reversed`. The `confirmed_referrals` count will include referrals that were later refunded. |
| **Impact** | Inflated referral counts displayed to users. Not a security issue but a data accuracy concern. |
| **Fix** | Add a `charge.refunded` or `charge.dispute.created` webhook handler that sets matching referrals to `reversed` status and deducts the credit via a new `reverse_referral_credit` SQL function. |

---

### 4.9 [LOW] Referral Link Parameter Sanitized Correctly

| Field | Detail |
|-------|--------|
| **Location** | `index.html:9534–9536` |
| **Finding** | The referral code from `?ref=` is sanitized with `_rc.replace(/[^a-zA-Z0-9_-]/g, '').slice(0,32)`, stripping any non-alphanumeric characters and limiting to 32 chars. This prevents XSS via URL parameters. The sanitized code is stored in `localStorage` and the URL is cleaned with `history.replaceState`. **Properly sanitized — no issue found.** |

---

## Domain 7: Subscription & Access Control

### 7.1 [HIGH] `trendAccess` Is a Global `let` — Overridable from Browser Console

| Field | Detail |
|-------|--------|
| **Severity** | HIGH |
| **Title** | Global `trendAccess` variable can be overwritten from browser console to unlock paid features |
| **Location** | `index.html:2433` |
| **Problem** | The variable is declared as:
```javascript
let trendAccess = { access: true, mode: 'trial', daysLeft: TRIAL_DAYS };
```
Any user can open the browser console and run:
```javascript
trendAccess = { access: true, mode: 'paid', plan: 'lifetime' };
```
This immediately unlocks all Trend-gated features in the current session. All feature gates check `trendAccess.access` or `trendAccess.mode` (lines 2675, 2710, 7596, 7635, 8403). |
| **Impact** | A user can access all paid features for free within a single browser session. The server-side `trend_active` is NOT modified — refreshing the page or re-checking will restore the correct state. This is a **client-side-only bypass** that affects the current session. |
| **Fix** | This is an inherent limitation of client-side JavaScript. Mitigation strategies:
1. **Wrap in closure**: Use an IIFE or module pattern so `trendAccess` is not on `window`:
```javascript
const TrendGuard = (() => {
  let _access = { access: true, mode: 'trial', daysLeft: 7 };
  return {
    get: () => ({ ..._access }),
    set: (v) => { _access = v; },
  };
})();
```
2. **Periodic re-validation**: Run `checkTrendAccess()` every 60 seconds and on every feature gate, not just at boot.
3. **Server-side gates for sensitive operations**: For plan generation or data export, validate `trend_active` server-side before returning data.
4. **Accept the limitation**: Since the real data lives server-side and is RLS-protected, the console bypass only affects UI rendering. No server data can be exfiltrated. |

---

### 7.2 [HIGH] Trial Period Enforced Server-Side — But Local Fallback Can Be Manipulated

| Field | Detail |
|-------|--------|
| **Severity** | HIGH |
| **Title** | `_checkTrendLocal()` reads `ik_trial_start` from localStorage — user can reset trial indefinitely |
| **Location** | `index.html:2436–2448` |
| **Problem** | For anonymous users (not logged in), the trial is enforced via `localStorage.getItem('ik_trial_start')`. A user can:
1. Open console
2. Run `localStorage.setItem('ik_trial_start', String(Date.now()))`
3. This resets the trial to a fresh 7 days
4. Repeat indefinitely

The function also resets corrupted timestamps (line 2440–2441): if `ts > Date.now()`, it resets to `Date.now()`. This means even setting a future timestamp gets corrected, but past timestamps are accepted. |
| **Impact** | Anonymous users can extend their trial indefinitely. This is somewhat mitigated by the fact that the server-side trial (`trial_end` in the `users` table) is the authoritative source for logged-in users. However, the entire anonymous trial flow is client-side-only and trivially bypassable. |
| **Fix** | Options:
1. **Require login for Trend access**: Remove the anonymous trial entirely and gate all Trend features behind authentication. This is the most secure option.
2. **Server-side anonymous trial**: Use a server-set cookie (HttpOnly, Secure) instead of localStorage. The Edge Function `checkTrendAccess` could issue a signed cookie with the trial start time.
3. **Accept the limitation**: If the business model accepts anonymous trials as a lead-generation tool, the current approach is acceptable with the understanding that determined users can bypass it. |

---

### 7.3 [INFO] checkTrendAccess Fallback Chain — Secure by Design

| Field | Detail |
|-------|--------|
| **Location** | `index.html:2455–2497` |
| **Finding** | The fallback chain is:
1. **No user (anonymous)** → `_checkTrendLocal()` (localStorage-based trial)
2. **Server error / RLS block** → `_checkTrendLocal()` (never expires the user on error)
3. **trend_active=true + grace_period_until** → grace mode (access=true, hoursLeft)
4. **trend_active=true, no grace** → paid mode (access=true)
5. **trial_end in future** → trial mode (access=true, daysLeft)
6. **No trial_end** → `_checkTrendLocal()` (new user fallback)
7. **Default** → expired (access=false)

The key security property: **errors always fall back to local trial, never to expired**. This prevents a malicious Supabase outage from locking out paying users. **Intentional and secure design — no issue found.** |

---

### 7.4 [MEDIUM] Grace Period Logic — Handled Correctly by Webhook

| Field | Detail |
|-------|--------|
| **Location** | `supabase/functions/stripe-webhook/index.ts:203–225, 229–260` |
| **Problem** | Grace period is set in two webhook handlers:
- `customer.subscription.deleted` (line 212): sets `grace_period_until = now() + 48h`, keeps `trend_active = true`
- `invoice.payment_failed` (line 246): same behavior, but only if grace not already set

The client-side `checkTrendAccess` (line 2470–2477) checks if `grace_period_until` is in the past and returns `{ access: false, mode: 'expired' }`.

**Gap**: There is no server-side mechanism to set `trend_active = false` after the grace period expires. The client relies on the timestamp comparison. If a user manipulates their local clock or intercepts the response, they could extend the grace period. However, the RLS trigger prevents direct manipulation of `grace_period_until`. |
| **Impact** | A user with an expired grace period will be correctly blocked by the client-side check on normal page loads. The only bypass would be through the `trendAccess` console override (see 7.1). |
| **Fix** | Add a scheduled Edge Function (cron) or a Supabase pg_cron job that sets `trend_active = false` when `grace_period_until < now()`:
```sql
-- Run every hour via pg_cron
UPDATE users
SET trend_active = false
WHERE grace_period_until IS NOT NULL
  AND grace_period_until < now()
  AND trend_active = true;
```
This provides a server-side backstop for grace period enforcement. |

---

### 7.5 [LOW] Subscription Lapse Mid-Session — No Real-Time Revocation

| Field | Detail |
|-------|--------|
| **Severity** | LOW |
| **Title** | If subscription lapses mid-session, user retains access until next `checkTrendAccess` call |
| **Location** | `index.html:2500–2525` (`initTrend` function) |
| **Problem** | The `trendAccess` state is set at boot time and on explicit `initTrend()` calls. There is no WebSocket listener or periodic poll to detect mid-session subscription changes. If a subscription is cancelled via Stripe webhook while the user is actively using the app, they will retain access until they refresh the page or `initTrend()` is called again. |
| **Impact** | Minor — the user gets a few extra minutes/hours of access in rare edge cases. The server-side state is always correct. |
| **Fix** | Consider calling `checkTrendAccess()` on each navigation between screens or on a 5-minute interval. This is a product decision, not a critical security fix. |

---

### 7.6 [INFO] All Trend-Gated Features Consistently Check `trendAccess.access`

| Field | Detail |
|-------|--------|
| **Location** | Multiple locations in `index.html`: 2675, 2710, 7596, 7635, 8403 |
| **Finding** | All Trend-gated features check `trendAccess.access` or `trendAccess.mode`:
- Plan generation: `if (trendAccess?.access)` at line 7596
- Blur overlay: `const locked = !trendAccess?.access` at line 7635
- Export badge: `const plan = trendAccess?.mode === 'paid' ? ...` at line 8403
- Feature gate: `if (trendAccess.access) { fn(); return; }` at line 2710
- Lock banner: display based on `trendAccess.access` at line 2517

All checks are consistent. **No issue found.** |

---

## Cross-Cutting: CORS Configuration

### CORS-1 [MEDIUM] CORS Wildcard on Three Edge Functions

| Field | Detail |
|-------|--------|
| **Severity** | MEDIUM |
| **Title** | `request-payout`, `generate-referral-code`, and `connect-onboard` use `Access-Control-Allow-Origin: *` |
| **Location** | `request-payout/index.ts:5`, `generate-referral-code/index.ts:4`, `connect-onboard/index.ts:4` |
| **Problem** | Three Edge Functions set CORS to `*` (allow any origin), while `create-checkout-session` and `create-portal-session` correctly restrict to `https://irokninetic-production.up.railway.app`. A malicious website could make authenticated requests to these functions if a user visits the attacker's site while logged in (the browser would send cookies, but Supabase uses Bearer tokens not cookies, so the actual risk is mitigated by the JWT requirement). |
| **Impact** | Low practical impact because all functions require a valid JWT in the Authorization header, which malicious sites cannot access. However, the wildcard CORS violates the principle of least privilege and could enable attacks if the auth model changes. |
| **Fix** | Align all Edge Functions to use the same restricted CORS origin:
```typescript
const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://irokninetic-production.up.railway.app',
  // ... add ironkinetic.app if custom domain is used
};
```

---

## Findings Summary Table

| # | Severity | Title | Domain |
|---|----------|-------|--------|
| 4.1 | **CRITICAL** | Referral migration truncated — RLS policies missing | Referral |
| 7.1 | **HIGH** | `trendAccess` global overridable from console | Access Control |
| 7.2 | **HIGH** | localStorage trial can be reset indefinitely | Access Control |
| 4.3 | **HIGH** | No cap on referral credit accumulation | Referral |
| 3.1 | **MEDIUM** | Deprecated `redirectToCheckout` in dead code | Checkout |
| 4.6 | **MEDIUM** | IdempotencyKey uses `Date.now()` — not idempotent | Referral |
| CORS-1 | **MEDIUM** | CORS wildcard on 3 Edge Functions | Cross-cutting |
| 7.4 | **MEDIUM** | No server-side grace period expiry enforcement | Access Control |
| 3.3 | **LOW** | Hardcoded Price IDs in dead code | Checkout |
| 3.4 | **LOW** | Stripe error messages surfaced to client | Checkout |
| 3.6 | **LOW** | 60s polling window may timeout | Checkout |
| 4.8 | **LOW** | confirmed_referrals not reversed on refund | Referral |
| 7.5 | **LOW** | No mid-session subscription revocation | Access Control |
| 3.2 | **INFO** | Stripe PK correctly uses live mode | Checkout |
| 3.5 | **INFO** | Success URL not tamperable | Checkout |
| 3.7 | **INFO** | trend_active RLS hardened with trigger | Checkout |
| 3.8 | **INFO** | Portal session properly authenticated | Checkout |
| 4.2 | **INFO** | Referral code generation is idempotent | Referral |
| 4.4 | **INFO** | Self-referral blocked in two places | Referral |
| 4.5 | **INFO** | Minimum payout threshold enforced | Referral |
| 4.7 | **INFO** | Stripe Connect onboarding is resumable | Referral |
| 4.9 | **INFO** | Referral link parameter properly sanitized | Referral |
| 7.3 | **INFO** | checkTrendAccess fallback chain is secure | Access Control |
| 7.6 | **INFO** | All Trend gates consistently check access | Access Control |

---

## Priority Remediation Order

1. **CRITICAL — Complete referral migration** (4.1): Run the missing RLS policies against production Supabase.
2. **HIGH — Add referral credit cap** (4.3): Update `add_referral_credit` SQL function with `LEAST()` cap.
3. **HIGH — Scope `trendAccess` in closure** (7.1): Wrap in IIFE to prevent trivial console override.
4. **HIGH — Address localStorage trial reset** (7.2): Decide between requiring login for Trend or accepting the limitation.
5. **MEDIUM — Remove dead `_clientSideCheckout`** (3.1): Delete 60 lines of dead code.
6. **MEDIUM — Fix CORS wildcards** (CORS-1): Align all functions to restricted origin.
7. **MEDIUM — Add grace period cron** (7.4): pg_cron job to expire grace periods server-side.
8. **MEDIUM — Fix idempotency key** (4.6): Use deterministic key for Stripe transfers.
9. **LOW items**: Address during next sprint.

---

*Audit complete. Total findings: 1 CRITICAL, 3 HIGH, 4 MEDIUM, 5 LOW, 9 INFO.*
