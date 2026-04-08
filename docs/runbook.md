# Iron Kinetic — Production Runbook

> Last updated: 2026-04-08 · Owner: Iron Kinetic Ops

---

## Table of Contents

1. [Billing Incident Response](#1-billing-incident-response)
2. [Rollback Procedure](#2-rollback-procedure)
3. [Secret Rotation Checklist](#3-secret-rotation-checklist)
4. [Monitoring Checklist](#4-monitoring-checklist)
5. [Support Recovery — Stuck Subscriptions](#5-support-recovery--stuck-subscriptions)

---

## 1. Billing Incident Response

### Symptoms
- Users report being charged but Trend features remain locked
- Stripe webhook events not reflected in Supabase
- `trend_active` column stuck `false` after successful checkout
- Users see "expired" badge despite having paid

### Immediate Actions

1. **Verify Stripe Dashboard**
   - Check `Payments` → recent transactions for the affected user
   - Confirm webhook delivery: `Developers` → `Webhooks` → look for failed deliveries
   - Verify the webhook endpoint matches: `SUPABASE_URL/functions/v1/stripe-webhook`

2. **Check Supabase**
   ```sql
   SELECT id, email, trend_active, trial_end, plan, grace_period_until
   FROM users
   WHERE email = 'affected-user@example.com';
   ```

3. **Manual Override (emergency only)**
   ```sql
   UPDATE users SET trend_active = true, plan = 'monthly'
   WHERE email = 'affected-user@example.com';
   ```
   Then invalidate the user's local cache by asking them to hard-refresh.

4. **Replay Failed Webhooks**
   - In Stripe Dashboard → `Webhooks` → click the failed event → `Retry`

### Escalation Path
- Stripe support: https://support.stripe.com
- Supabase support: https://supabase.com/support

---

## 2. Rollback Procedure

### When to Rollback
- Production black screen or critical JS error affecting >50% of users
- Onboarding flow completely broken
- Auth flow broken preventing login

### Steps

1. **Identify the bad commit**
   ```bash
   git log --oneline -10
   ```

2. **Revert the specific commit**
   ```bash
   git revert <commit-sha> --no-edit
   git push origin main
   ```

3. **Full rollback to known-good state**
   ```bash
   # Find last known-good commit
   git log --oneline | head -20
   # Reset to it
   git reset --hard <good-commit-sha>
   git push origin main --force
   ```
   ⚠️ **Force push only in emergencies** — coordinate with team first.

4. **Verify Railway Redeploy**
   - Check Railway dashboard: https://railway.app
   - Confirm new deploy triggered from the push
   - Wait for deploy to complete (~2-3 min)
   - Test production URL: https://irokninetic-production.up.railway.app/

5. **Post-Rollback Verification**
   - [ ] Homepage loads without black screen
   - [ ] GDPR gate appears and accepts
   - [ ] Onboarding completes end-to-end
   - [ ] Login with Google works
   - [ ] Trend section loads for paid users
   - [ ] Stripe checkout flow works

---

## 3. Secret Rotation Checklist

### Secrets in Scope
| Secret | Location | Rotation Frequency |
|--------|----------|-------------------|
| `SUPABASE_URL` | index.html (public), Railway env vars | On compromise |
| `SUPABASE_ANON_KEY` | index.html (public), Railway env vars | On compromise |
| `STRIPE_PK` | index.html (public) | On compromise |
| `STRIPE_WEBHOOK_SECRET` | Supabase Edge Function env vars | Quarterly or on compromise |
| `STRIPE_SECRET_KEY` | Supabase Edge Function env vars | Quarterly or on compromise |
| `SENTRY_DSN` | index.html | On compromise |

### Rotation Procedure

1. **Supabase Keys**
   - Generate new anon key in Supabase Dashboard → `Settings` → `API`
   - Update `SUPABASE_KEY` in `index.html` (line ~1982)
   - Update Railway environment variable
   - Redeploy

2. **Stripe Keys**
   - Roll API keys in Stripe Dashboard → `Developers` → `API Keys` → `Roll key`
   - Update `STRIPE_PK` in `index.html` (line ~1984)
   - Update `STRIPE_SECRET_KEY` in Supabase Edge Function secrets
   - Update webhook signing secret if needed
   - Redeploy both services

3. **Post-Rotation Verification**
   - [ ] New checkout session completes
   - [ ] Webhook delivery succeeds
   - [ ] Existing subscribers can access Trend
   - [ ] No errors in Sentry (after DSN update)

---

## 4. Monitoring Checklist

### Daily Checks
- [ ] Sentry error rate < 1% of sessions
- [ ] No new unhandled exceptions
- [ ] Stripe webhook delivery success > 99%
- [ ] Railway deploy health: all green

### Weekly Checks
- [ ] Review Sentry performance metrics (p95 latency < 3s)
- [ ] Supabase dashboard: no abnormal query patterns
- [ ] Stripe dispute rate < 0.5%
- [ ] User feedback channels: no billing complaints
- [ ] Test onboarding flow end-to-end on production

### Monthly Checks
- [ ] Rotate Stripe webhook signing secret
- [ ] Review Supabase RLS policies
- [ ] Audit Railway resource usage
- [ ] Update SRI hashes if CDN scripts changed
- [ ] Review and update this runbook

### Monitoring Endpoints
- **Sentry Dashboard**: https://sentry.io (configure with real DSN)
- **Supabase Dashboard**: https://supabase.com/dashboard/project/qfmyhgrrkshcqxrwbyle
- **Stripe Dashboard**: https://dashboard.stripe.com
- **Railway Dashboard**: https://railway.app
- **Production URL**: https://irokninetic-production.up.railway.app/

### Alert Thresholds
| Metric | Warning | Critical |
|--------|---------|----------|
| Error Rate (Sentry) | > 0.5% sessions | > 2% sessions |
| Webhook Failures | > 1/hour | > 5/hour |
| Railway Deploy Time | > 5 min | > 10 min |
| Supabase Latency (p95) | > 500ms | > 2s |

---

## 5. Support Recovery — Stuck Subscriptions

### Common Scenarios

#### Scenario A: User paid but Trend remains locked
1. Check Stripe for successful payment: `Payments` → search by email
2. Check Supabase `users` table for `trend_active` status
3. If `trend_active = false` despite payment:
   ```sql
   UPDATE users SET trend_active = true, plan = 'monthly', grace_period_until = NULL
   WHERE email = 'user@example.com';
   ```
4. Ask user to hard-refresh (Ctrl+Shift+R) or clear cache

#### Scenario B: Trial expired but user claims they signed up recently
1. Check `ik_trial_start` in user's localStorage (ask for screenshot)
2. Check Supabase `users.trial_end` for account users
3. If trial was incorrectly started (browser glitch):
   ```sql
   UPDATE users SET trial_end = NOW() + INTERVAL '7 days'
   WHERE email = 'user@example.com' AND trend_active = false;
   ```

#### Scenario C: Grace period exhausted — user locked out after late payment
1. Check Stripe for recent payment attempts
2. If payment succeeded during grace period:
   ```sql
   UPDATE users SET trend_active = true, grace_period_until = NULL, plan = 'monthly'
   WHERE email = 'user@example.com';
   ```
3. If payment failed, offer to extend grace period:
   ```sql
   UPDATE users SET grace_period_until = NOW() + INTERVAL '24 hours'
   WHERE email = 'user@example.com';
   ```

#### Scenario D: User wants to cancel subscription
1. Direct them to billing portal: trigger `openBillingPortal()` from console
2. Or cancel in Stripe Dashboard → `Customers` → find customer → cancel subscription
3. Set `trend_active = false` in Supabase after cancellation confirms
4. User retains access until end of paid period

### Contact Information
- **Technical issues**: Check Sentry first, then Supabase logs
- **Stripe billing**: https://dashboard.stripe.com/support
- **User-facing support**: privacy@ironkinetic.app

---

## Emergency Contacts

| Role | Contact | Availability |
|------|---------|-------------|
| Ops Lead | @AgentZero via project channel | Business hours |
| Stripe Support | https://support.stripe.com | 24/7 |
| Supabase Support | https://supabase.com/support | Business hours |
| Railway Support | https://railway.app/help | Business hours |

---

*This runbook is version-controlled. Update via PR to `main` branch.*
