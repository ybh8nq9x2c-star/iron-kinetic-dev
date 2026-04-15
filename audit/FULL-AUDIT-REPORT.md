# Iron Kinetic — Full Application Audit Report

**Date:** 2026-04-15
**Scope:** index.html (10,798 lines) + 6 Edge Functions + server.js + sw.js
**Auditors:** AgentZero Security, Developer, and Research teams

---

## Executive Summary

| Domain | CRITICAL | HIGH | MEDIUM | LOW | INFO | Total |
|--------|----------|------|--------|-----|------|-------|
| 🔐 Security | 3 | 5 | 6 | 4 | 5 | 23 |
| 💳 Stripe/Sub/Referral | 1 | 3 | 4 | 5 | 9 | 22 |
| 🧮 Nutrition/Onboarding/I18N/A11Y | 3 | 10 | 11 | 5 | 2 | 31 |
| 🐛 Bugs/Performance | 15 | 28 | 39 | 26 | 16 | 124 |
| **TOTAL** | **22** | **46** | **60** | **40** | **32** | **200** |

---

## 🔴 Priority Matrix — Top 10 Issues by Risk × Effort

| # | Issue | Domain | Risk | Effort | Impact |
|---|-------|--------|------|--------|--------|
| 1 | **Rotate Stripe sk_live + webhook secret** (exposed in memory) | Security | 💀 Account takeover | 30 min | Full Stripe admin access |
| 2 | **CORS `*` on payout/connect/referral Edge Functions** | Security | 💀 CSRF → financial theft | 15 min | Arbitrary payment redirection |
| 3 | **Referral migration truncated — RLS never created** | Stripe/Ref | 💀 Data breach | 30 min | Any user reads any referral/payout data |
| 4 | **Allergen bypass in buildSnack() + buildBreakfast()** | Nutrition | ⚠️ Food safety | 1 hr | Allergic users served dangerous foods |
| 5 | **Adaptive engine uses oldest checkins `slice(0,5)`** | Bugs | ⚠️ Wrong advice | 1 line | Calorie adjustments based on stale data |
| 6 | **Body comp shift computed but discarded** | Bugs | ⚠️ Wrong advice | 1 line | Calorie target ignores body composition |
| 7 | **Paywall bypass via localStorage trial reset** | Security | ⚠️ Revenue loss | 2 hrs | Free unlimited premium access |
| 8 | **trendAccess global overridable from console** | Sub/Access | ⚠️ Revenue loss | 30 min | `window.trendAccess={access:true}` |
| 9 | **Boot-path null derefs cause black screen** | Bugs | ⚠️ UX crash | 1 hr | App unusable if any gate element missing |
| 10 | **Railway tokens committed in .env.railway** | Security | 💀 Infra takeover | 10 min | Deploy malicious code to production |

---

## ⚡ Quick Wins — Fixable in < 30 Minutes Each

### 1-Line Fixes (batch into single commit)

| # | Fix | Line | File |
|---|-----|------|------|
| Q1 | `slice(0,5)` → `slice(-5)` in adaptive engine | L5370 | index.html |
| Q2 | Apply `bcs.shift` to `_k` (body comp adjustment) | L5302-5304 | index.html |
| Q3 | Fix `tonno` alias apostrophe | L6593 | index.html |
| Q4 | Add `defer` to Supabase SDK `<script>` | L929 | index.html |
| Q5 | Wrap `_checkTrendLocal()` in try/catch | L2437-2447 | index.html |
| Q6 | Async-load Material Symbols CSS | L19 | index.html |
| Q7 | Remove duplicate `notif-perm-btn` ID | L2162 | index.html |

### Edge Function CORS Fix (15 min)

Replace `Access-Control-Allow-Origin: *` with explicit origin on:
- `request-payout/index.ts`
- `generate-referral-code/index.ts`
- `connect-onboard/index.ts`

```typescript
const allowedOrigins = ['https://irokninetic-production.up.railway.app'];
const origin = req.headers.get('origin') || '';
const corsOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
```

### Secret Rotation (30 min)

1. Rotate Stripe sk_live key → Stripe Dashboard → Developers → API Keys
2. Rotate webhook secret → Stripe Dashboard → Developers → Webhooks
3. Rotate Railway tokens → Railway Dashboard → Settings → Tokens
4. Delete `.env.railway` from repo history: `git filter-branch`
5. Add `.env.railway` to `.gitignore` (already done)

---

## 🖥️ Requires Backend — Supabase / Stripe Changes

| # | Issue | Action Needed |
|---|-------|-------------|
| B1 | **Referral tables have no RLS** | Complete migration `20260413_referral_system.sql` — add RLS policies for `referral_codes`, `referrals`, `payout_requests` |
| B2 | **Cap referral credits** | Add `LEAST()` ceiling to `add_referral_credit()` SQL function |
| B3 | **Trial period not server-verified** | Add Supabase Edge Function to verify trial_end from `profiles` table, not localStorage |
| B4 | **Grace period not expired server-side** | Webhook should check `grace_period_until < now()` and revoke access |
| B5 | **Referrals not reversed on refund** | Add `customer.subscription.deleted` webhook handler to decrement referral counts |
| B6 | **No rate limiting on Edge Functions** | Add rate limiting via Supabase Edge Function middleware or upstream proxy |
| B7 | **Missing HSTS header** | Add `Strict-Transport-Security` in server.js or Railway config |
| B8 | **CSP too permissive** | Tighten CSP — move inline handlers to external JS or use nonce-based CSP |

---

## 📊 Domain-by-Domain Summary

### 🔐 Security (23 findings)
- 3 CRITICAL: Exposed secrets, CORS wildcards
- Stripe webhook verification is solid ✅
- RLS hardening with BEFORE UPDATE trigger ✅
- Anti-self-referral protection ✅

### 💳 Checkout & Stripe (22 findings)
- Deprecated `redirectToCheckout` still present as dead code
- Price IDs hardcoded as fallbacks
- Webhook idempotency guard working correctly ✅
- Portal session properly authenticated ✅

### 🎁 Referral System (included in Stripe audit)
- Migration truncated — RLS policies never applied
- No credit cap — abuse potential
- Self-referral double-block working ✅
- Payout threshold enforced server-side ✅

### 🐛 Bugs & Runtime (124 findings)
- 15 CRITICAL: localStorage crashes, null derefs, wrong data flows
- 41 empty catch blocks swallowing errors silently
- Adaptive engine and body comp shift are major calculation bugs
- Notification timer chain has unbounded memory leak

### 🧮 Nutrition (31 findings)
- Core formulas (Mifflin-St Jeor, Katch-McArdle) correctly implemented ✅
- Clinical protocols (CKD, DASH, IBS, T2D) medically accurate ✅
- CRITICAL: Allergen filtering missing in buildSnack() and buildBreakfast()
- CRITICAL: FODMAP flags missing for apple/pear in IBS protocol

### 🚀 Onboarding (included in Nutrition audit)
- State not restored if app closed mid-flow
- No re-validation before plan generation
- Double-tap race condition on generate button

### 🌍 I18N (included in Nutrition audit)
- Hardcoded Italian strings in JS visible to English users
- `t()` fallback chain works correctly ✅
- Dates and numbers not locale-aware

### ♿ Accessibility (included in Nutrition audit)
- Touch targets too small on some elements
- Focus trap exists for modals ✅
- Color contrast insufficient on muted text

### ⚡ Performance (included in Bugs audit)
- Supabase SDK blocks initial render (~200KB synchronous)
- Chart.js correctly lazy-loaded ✅
- 880 lines inline CSS in single file — significant mobile payload

---

## 📁 Full Reports

| Report | File | Findings |
|--------|------|----------|
| Security | `audit/security-audit.md` | 23 |
| Stripe/Sub/Referral | `audit/stripe-subscription-referral-audit.md` | 22 |
| Nutrition/Onboarding/I18N/A11Y | `audit/nutrition-onboarding-i18n-a11y-audit.md` | 31 |
| Bugs/Performance | `audit/bugs-performance-audit.md` | 124 |

---

## Recommended Action Plan

### Phase 1 — Immediate (Today)
1. Rotate all exposed secrets (Stripe, Railway, Supabase)
2. Fix CORS on 3 Edge Functions
3. Apply 7 quick-win 1-line fixes
4. Fix allergen filtering in buildSnack/buildBreakfast

### Phase 2 — This Week
5. Complete referral migration (add RLS policies)
6. Fix adaptive engine + body comp shift bugs
7. Wrap trendAccess in closure
8. Add try/catch to boot-path null derefs
9. Cap referral credits in SQL function

### Phase 3 — Next Sprint
10. Async-load Supabase SDK and Material Symbols
11. Fix onboarding state restoration
12. Remove deprecated redirectToCheckout dead code
13. Add locale-aware date/number formatting
14. Fix accessibility touch targets and contrast

### Phase 4 — Backlog
15. Move to nonce-based CSP (architectural change)
16. Add rate limiting to Edge Functions
17. Debounce expensive input handlers
18. Clean up 41 empty catch blocks
