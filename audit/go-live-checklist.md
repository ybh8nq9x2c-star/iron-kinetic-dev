# Iron Kinetic — Go-Live Checklist

**Date:** 2026-04-08
**Verdict:** NOT READY
**Target:** Production deployment with real payments

---

## 🔴 BLOCKERS (Must fix before launch)

### Billing / Payments
- [ ] **B-01** Fix `startCheckout()` to send `{price_tier: plan}` instead of `{priceId, mode, ...}`
  - File: `index.html:~2109-2126`
  - EF expects `price_tier` at `create-checkout-session/index.ts:50`
  - Effort: S (15 min)

- [ ] **B-02** Replace `STRIPE_PK` with `pk_live_...` key
  - File: `index.html:~1981`
  - Currently `pk_test_...` — no real payments possible
  - Effort: S (5 min)

- [ ] **B-03** Create annual price in Stripe Dashboard → replace placeholder
  - File: `index.html:~1980` — `STRIPE_PRICE_ANNUAL_PLACEHOLDER`
  - Create 39.99€/yr recurring price in Stripe
  - Effort: S (10 min)

- [ ] **B-04** Deploy 3 Edge Functions to Supabase
  - `supabase functions deploy stripe-webhook`
  - `supabase functions deploy create-checkout-session`
  - `supabase functions deploy create-portal-session`
  - Effort: S (15 min)

- [ ] **B-05** Set production secrets in Supabase
  - `STRIPE_SECRET_KEY=sk_live_...`
  - `STRIPE_WEBHOOK_SECRET=whsec_...`
  - `STRIPE_PRICE_MONTHLY=price_...`
  - `STRIPE_PRICE_ANNUAL=price_...` (after creating)
  - `STRIPE_PRICE_LIFETIME=price_...`
  - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`
  - `APP_URL=https://irokninetic-production.up.railway.app`
  - Effort: S (10 min)

- [ ] **B-06** Configure Stripe webhook endpoint
  - URL: `https://qfmyhgrrkshcqxrwbyle.supabase.co/functions/v1/stripe-webhook`
  - Events: `checkout.session.completed`, `invoice.payment_succeeded`, `customer.subscription.deleted`, `invoice.payment_failed`
  - Copy signing secret to `STRIPE_WEBHOOK_SECRET`
  - Effort: S (10 min)

### Security

- [ ] **D-01** Restrict RLS UPDATE policy on `users` table
  - Current: blanket UPDATE allows users to set `trend_active=true`
  - Fix: Create trigger or column-restricted policy that prevents direct billing column updates
  - File: `supabase/migrations/20260408_billing_schema.sql:142-144`
  - Effort: M (30-60 min)

---

## 🟡 HIGH PRIORITY (Should fix before launch)

- [ ] **B-07** Remove localStorage bypass on checkout success
  - File: `index.html:~2277` — `localStorage.setItem('ik_trend_active','1')`
  - Replace with server verification: poll Supabase `users.trend_active` after redirect
  - Effort: M (30 min)

- [ ] **D-02** Remove localStorage short-circuit in `checkTrendAccess()`
  - File: `index.html:~2006` — returns `paid` on localStorage value
  - Always verify with Supabase for logged-in users
  - Effort: S (15 min)

- [ ] **D-03** Remove SUPABASE_KEY Bearer fallback in checkout
  - File: `index.html:~2116` — `(accessToken||SUPABASE_KEY)`
  - Require auth before checkout; show login modal if not authenticated
  - Effort: S (15 min)

- [ ] **E-04** Restrict CORS to production domain
  - Files: `create-checkout-session/index.ts:6`, `create-portal-session/index.ts:6`
  - Change `'*'` to `'https://irokninetic-production.up.railway.app'`
  - Effort: S (5 min)

---

## 🟢 RECOMMENDED (Fix within first week)

- [ ] **E-02** Add CSP headers
- [ ] **E-03** Add SRI to CDN scripts
- [ ] **E-01** Sanitize remaining 13 innerHTML calls
- [ ] **H-01** Integrate Sentry for error monitoring
- [ ] **H-02** Document rollback procedure
- [ ] **I-01** Add age confirmation to GDPR consent gate
- [ ] **I-02** Fix "Dati su server: Nessuno" to be conditional
- [ ] **A-01** Translate 98 static elements + food tags

---

## ✅ ALREADY PASSING

- [x] Auth flow (Google OAuth + session restore)
- [x] PWA install (manifest + service worker valid)
- [x] Trial flow (7-day trial activates correctly)
- [x] Grace period (48h on payment failure)
- [x] Webhook idempotency (processed_events table)
- [x] GDPR consent gate
- [x] Offline shell (service worker + offline.html)
- [x] Trend lock scoped to Trend screen only
- [x] IT/EN language switching core mechanism

---

## 🚀 LAUNCH SEQUENCE

1. Fix B-01 (checkout payload)
2. Fix D-01 (RLS trigger)
3. Fix B-02 (live Stripe key)
4. Fix B-03 (annual price)
5. Fix D-02 + D-03 (localStorage/auth)
6. Fix E-04 (CORS)
7. Deploy EFs (B-04)
8. Set secrets (B-05)
9. Configure webhook (B-06)
10. E2E test with Stripe CLI
11. Deploy frontend to Railway
12. Smoke test production

**Estimated time to launch-ready:** 4-6 hours of focused work
