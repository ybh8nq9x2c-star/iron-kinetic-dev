# Backend Security Audit P2 — Iron Kinetic

**Date:** 2026-04-18
**Commit:** `43a6d6f`
**Branch:** `main`
**Preceded by:** P1 commit `5d1bb45` (RLS, Edge Functions, Webhook, Referral)

---

## Executive Summary

P2 completes the backend security hardening across 5 areas: trial exploit client-side hardening, GDPR right-to-erasure, payout audit logging, session management, and monitoring infrastructure. All changes are production-safe with minimal diff scope.

---

## AREA 2: Trial Exploit — Client-Side Hardening

### 2a. SIGNED_OUT event handler ✅
**File:** `index.html` (line ~3324)
**Change:** Added `SIGNED_OUT` handler in `onAuthStateChange` listener.

```js
if(event==='SIGNED_OUT'){
  if(typeof setTrendAccess==='function')setTrendAccess({access:false,mode:'none',daysLeft:0,plan:null});
  if(typeof updateTrendBadge==='function')updateTrendBadge();
  _cachedSession=null;
}
```

**Impact:** When session expires or user signs out from another device, trend access is immediately revoked client-side. Prevents stale `access:true` state.

### 2b. Token in URL cleanup ✅
**File:** `index.html` (line ~3418)
**Change:** Added IIFE to strip `#access_token=...` from URL hash on page load.

```js
(()=>{if(location.hash.includes('access_token='))history.replaceState({},'',location.pathname+location.search);})();
```

**Impact:** Prevents OAuth token from leaking via Referer headers or third-party analytics scripts.

### 2c. ik_trial_start removed from KEEP_PREFIX ✅
**File:** `index.html` (line ~8910)
**Before:** `const KEEP_PREFIX=['ikgdpr','iklang','iknotif','ik_trial_start'];`
**After:** `const KEEP_PREFIX=['ikgdpr','iklang','iknotif'];`

**Impact:** `ik_trial_start` no longer survives "Start over" / clear operations, closing the client-side trial reset exploit vector.

---

## AREA 6: GDPR Compliance

### 6a. Delete Account Edge Function ✅
**File:** `supabase/functions/delete-account/index.ts` (NEW — 160 lines)

**Features:**
- POST endpoint with JWT verification
- Rate limited: 2 requests/hour/user (in-memory Map)
- Deletes Stripe customer (non-blocking on failure)
- Deletes user row from `public.users`
- Deletes related data: `referral_codes`, `referrals`, `payout_requests`, `payout_log`
- Writes to `audit_log` before auth user deletion
- Deletes auth user via `supabase.auth.admin.deleteUser()` (invalidates all sessions)
- CORS restricted to ALLOWED_ORIGINS

**Flow:**
```
JWT verify → Rate limit → Fetch user data → Delete Stripe customer → Delete DB rows → Audit log → Delete auth user
```

### 6b. Client-side trigger ✅
**File:** `index.html` — `clearAppData()` function rewritten

**Change:** `clearAppData()` now:
1. Captures current session before signOut
2. Performs signOut + localStorage clear as before
3. If user was logged in, calls `delete-account` Edge Function via POST

**Signature:** `clearAppData(opts)` — accepts `{serverDelete: false}` to skip EF call (for reset-profile flows).

---

## AREA 8: Rate Limiting & Payout Logging

### 8a. payout_log table ✅
**File:** `supabase/migrations/20260418_p2_hardening.sql`

```sql
CREATE TABLE IF NOT EXISTS public.payout_log (
    id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id             UUID NOT NULL,
    amount_cents        INT NOT NULL,
    stripe_transfer_id  TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);
-- RLS enabled, owner can SELECT own rows only
-- service_role has full access
```

**Integration:** `request-payout` EF now inserts into `payout_log` after successful Stripe transfer.

### 8b. Rate limits table (infrastructure) ✅
**File:** `supabase/migrations/20260418_p2_hardening.sql`

```sql
CREATE TABLE IF NOT EXISTS public.rate_limits (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id     UUID NOT NULL,
    action      TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
-- Includes cleanup_rate_limits() function for auto-purge
```

**Note:** In-memory Map approach from P1 remains active in EFs. This table is infrastructure for future centralized rate limiting.

---

## AREA 9: Session Management

### 9a. _cachedSession invalidation ✅
**Status:** Covered by SIGNED_OUT handler (Area 2a).
- `_cachedSession` is set to `null` on SIGNED_OUT event
- `autoRefreshToken: true` confirmed in Supabase client init (line 2635)

### 9b. Cross-tab session sync ✅
**Status:** Handled by Supabase's built-in cross-tab broadcast.
- `onAuthStateChange` fires `SIGNED_OUT` across all tabs when signOut occurs in one tab
- SIGNED_OUT handler clears trend access and session cache in all open tabs

---

## AREA 10: Monitoring

### 10a. Audit log table ✅
**File:** `supabase/migrations/20260418_p2_hardening.sql`

```sql
CREATE TABLE IF NOT EXISTS public.audit_log (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id     UUID,
    action      TEXT NOT NULL,
    metadata    JSONB,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
-- RLS enabled, NO user access — service_role only
-- Indexes on user_id, action, created_at
```

**Logged events:**
| EF | Action | Metadata |
|---|---|---|
| `create-checkout-session` | `checkout_session_created` | session_id, plan, referral_code |
| `request-payout` | `payout_completed` | amount_cents, transfer_id |
| `delete-account` | `account_deleted` | email, stripe_customer_id, deleted_at |

### 10b. Sentry integration check ✅
**Status:** Verified safe.
- DSN embedded in CDN URL: `53415d8991f07ae380ca333e9e7aabee` (public key, no secret)
- Sentry captures only stacktraces and error messages
- No email, tokens, or PII in Sentry payloads
- `Sentry.captureException()` used for error boundaries
- `Sentry.captureMessage()` used for specific checkout errors (status code only)
- No `user.email` or `access_token` passed to any Sentry call

---

## Files Modified

| File | Change |
|---|---|
| `index.html` | SIGNED_OUT handler, URL token cleanup, KEEP_PREFIX fix, clearAppData GDPR integration |
| `supabase/functions/delete-account/index.ts` | NEW — GDPR right-to-erasure Edge Function |
| `supabase/functions/request-payout/index.ts` | payout_log + audit_log inserts |
| `supabase/functions/create-checkout-session/index.ts` | audit_log insert |
| `supabase/migrations/20260418_p2_hardening.sql` | NEW — payout_log, audit_log, rate_limits tables |

## Files Deleted (cleanup)

| File | Reason |
|---|---|
| `fix_1_add_keys.py` | Stale utility script |
| `fix_high_i18n.py` | Stale utility script |

---

## Migration Instructions

1. Apply `supabase/migrations/20260418_p2_hardening.sql` to Supabase project
2. Deploy Edge Functions: `supabase functions deploy delete-account`
3. Redeploy existing EFs with audit logging: `supabase functions deploy request-payout create-checkout-session`
4. Verify `delete-account` EF is accessible at `/functions/v1/delete-account`

---

## Security Posture Summary

| Area | Before P2 | After P2 |
|---|---|---|
| Trial exploit (client) | ik_trial_start preserved, no SIGNED_OUT handling | Token cleaned, access revoked on signout, trial_start cleared |
| GDPR Art. 17 | No server-side account deletion | Full Edge Function with Stripe + DB + Auth cleanup |
| Payout audit trail | Only payout_requests table | Dedicated payout_log + audit_log tables |
| Session management | _cachedSession stale on signout | Cleared on SIGNED_OUT, cross-tab sync |
| Monitoring | Console logs only | Structured audit_log for critical operations |
| Sentry | Safe (verified) | Safe (re-verified, no PII) |

---

*Report generated by Agent Zero — Backend Security Audit P2*
