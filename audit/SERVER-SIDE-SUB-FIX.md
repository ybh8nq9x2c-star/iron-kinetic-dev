# Server-Side Subscription Verification Fix

**Date:** 2026-04-17
**Commit:** `f2298ea`
**Branch:** `main` (pushed to `origin/main`)
**Backup:** `backup/20260417_server_sub_verify`

## Problem Statement

ALL access control for the Trend section was client-side only. Attackers could bypass the paywall by:. Modifying `localStorage` keys (`ik_trial_start`, `ik_trial_resets`, `ik_trend_active`)
2. Removing the CSS blur overlay (`#scr-prog-blur-overlay`) via DevTools
3. Overriding `trendAccess` global variable in console (partially mitigated by Proxy)
4. Setting `_trendState.access = true` directly

The root cause: `checkTrendAccess()` fell back to `_checkTrendLocal()` which read localStorage as truth source, and the server query used the anon key (client could manipulate RLS bypass attempts).

## Solution Architecture

### Single Source of Truth: `verify-subscription` Edge Function

All subscription verification now flows through a single Edge Function that:
- **Uses SERVICE ROLE KEY** — client cannot forge or manipulate this
- **Validates user JWT** — confirms identity via Supabase Auth
- **Reads canonical subscription data** from `users` table
- **Computes access** based on: paid (trend_active), trial (trial_end > now), grace (grace_period_until > now), or none
- **Returns structured JSON** — no client-side computation of access status
- **Rate limited** — 30 requests/minute per user

### Client-Side Changes

| Area | Before | After |
|------|--------|-------|
| `_checkTrendLocal()` | Read localStorage trial timestamps | Returns `{access:false}` — no local truth |
| `checkTrendAccess()` | Queried Supabase directly + localStorage fallback | POSTs to `verify-subscription` EF, denies on error |
| `_trendState` default | `{access:true, mode:'trial'}` | `{access:false, mode:'none'}` — server must confirm |
| `switchTab('prog')` | Direct render, no re-verify | Calls `checkTrendAccess()` before rendering |
| `activatePlanAndContinue()` | Set `ik_trial_start` in localStorage | No localStorage — trial starts via EF on first access |
| `pollTrendActivation()` | Direct Supabase query | Uses `checkTrendAccess()` (goes through EF) |
| `KEEP_PREFIX` | Included `ik_trial_start` | Removed — no more trial in localStorage |

### Non-Removable Paywall

The CSS blur overlay remains as a visual layer, but the real protection is structural:
- When `trendAccess.access === false`, the Trend tab container renders ONLY a paywall card
- `renderRealTDEE()` and other trend functions guard with `if(!trendAccess?.access) return;`
- No real data is ever fetched or rendered without server-verified access
- Tab switching re-verifies every time the user navigates to Trend

## Files Modified

| File | Change |
|------|--------|
| `supabase/functions/verify-subscription/index.ts` | **NEW** — 202 lines, server-side verification EF |
| `supabase/migrations/20260417_subscription_verify.sql` | **NEW** — 47 lines, idempotent schema + indexes |
| `index.html` | Modified — 51 insertions, 77 deletions |

## Edge Function API

```
POST /functions/v1/verify-subscription
Headers:
  Authorization: Bearer <access_token>
  apikey: <anon_key>
  Content-Type: application/json

Response 200:
{
  "access": boolean,
  "mode": "paid" | "trial" | "grace" | "none",
  "daysLeft": number,
  "hoursLeft": number,
  "plan": string | null,
  "trial_end": string | null
}

Response 401: { "error": "Invalid or expired token" }
Response 429: { "error": "Too many requests" }
```

## Security Guarantees

1. **No client-side trust**: Access is NEVER granted from localStorage or client computation
2. **Service Role Key**: EF reads user data with elevated privileges — client cannot manipulate
3. **JWT validation**: User identity is cryptographically verified before any data access
4. **Fail-closed**: On any error (network, auth, server), access is DENIED
5. **Re-verification on tab switch**: Expired subscriptions caught mid-session
6. **Rate limited**: 30 req/min prevents brute-force probing

## What Was NOT Changed

- Stripe webhook flow (`stripe-webhook` still sets `trend_active=true` on payment)
- Checkout flow (`create-checkout-session`, success redirect)
- Subscription management UI
- `trendAccess` Proxy (kept for console protection)
- `setTrendAccess()` (kept as single setter)
- RLS policies on `users` table

## Deployment Steps

1. **Edge Function**: Deploy `verify-subscription` to Supabase (requires `SUPABASE_SERVICE_ROLE_KEY` env var)
2. **Migration**: Run `20260417_subscription_verify.sql` against Supabase PostgreSQL
3. **Verify**: Test with `curl -X POST -H "Authorization: Bearer <token>" <SUPABASE_URL>/functions/v1/verify-subscription`

## Rollback

If issues arise, restore from backup branch:
```bash
git checkout backup/20260417_server_sub_verify
```
