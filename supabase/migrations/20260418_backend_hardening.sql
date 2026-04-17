-- ============================================================
-- Iron Kinetic — Backend Hardening Migration
-- Date: 2026-04-18
-- Purpose: Comprehensive security hardening across RLS, triggers,
--          referral tables, and sensitive field protection.
-- ============================================================

-- ═══════════════════════════════════════════════════════════════
-- 1. FIX: Drop the overly broad UPDATE policy re-introduced by
--    20260416_users_rls.sql (undid billing hardening)
-- ═══════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Users can update own row" ON public.users;

-- Ensure restricted UPDATE policy exists (includes referral_credit_cents)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'users'
          AND policyname = 'Users can update own non-billing fields'
    ) THEN
        CREATE POLICY "Users can update own non-billing fields" ON public.users
          FOR UPDATE USING (auth.uid() = id)
          WITH CHECK (
            auth.uid() = id
            AND trend_active = (SELECT trend_active FROM public.users WHERE id = auth.uid())
            AND plan = (SELECT plan FROM public.users WHERE id = auth.uid())
            AND stripe_customer_id IS NOT DISTINCT FROM (SELECT stripe_customer_id FROM public.users WHERE id = auth.uid())
            AND stripe_subscription_id IS NOT DISTINCT FROM (SELECT stripe_subscription_id FROM public.users WHERE id = auth.uid())
            AND current_period_start IS NOT DISTINCT FROM (SELECT current_period_start FROM public.users WHERE id = auth.uid())
            AND current_period_end IS NOT DISTINCT FROM (SELECT current_period_end FROM public.users WHERE id = auth.uid())
            AND cancel_at_period_end IS NOT DISTINCT FROM (SELECT cancel_at_period_end FROM public.users WHERE id = auth.uid())
            AND grace_period_until IS NOT DISTINCT FROM (SELECT grace_period_until FROM public.users WHERE id = auth.uid())
            AND trial_end IS NOT DISTINCT FROM (SELECT trial_end FROM public.users WHERE id = auth.uid())
            AND referral_credit_cents IS NOT DISTINCT FROM (SELECT referral_credit_cents FROM public.users WHERE id = auth.uid())
          );
    END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 2. FIX: Update trigger to protect referral_credit_cents
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.protect_billing_columns()
RETURNS TRIGGER AS $$
BEGIN
  -- If the calling role is service_role, allow everything
  IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- For all other roles, prevent changes to billing/sensitive columns
  IF OLD.trend_active IS DISTINCT FROM NEW.trend_active THEN
    RAISE EXCEPTION 'Cannot modify trend_active directly';
  END IF;
  IF OLD.plan IS DISTINCT FROM NEW.plan THEN
    RAISE EXCEPTION 'Cannot modify plan directly';
  END IF;
  IF OLD.stripe_customer_id IS DISTINCT FROM NEW.stripe_customer_id THEN
    RAISE EXCEPTION 'Cannot modify stripe_customer_id directly';
  END IF;
  IF OLD.stripe_subscription_id IS DISTINCT FROM NEW.stripe_subscription_id THEN
    RAISE EXCEPTION 'Cannot modify stripe_subscription_id directly';
  END IF;
  IF OLD.current_period_start IS DISTINCT FROM NEW.current_period_start THEN
    RAISE EXCEPTION 'Cannot modify billing timestamps directly';
  END IF;
  IF OLD.current_period_end IS DISTINCT FROM NEW.current_period_end THEN
    RAISE EXCEPTION 'Cannot modify billing timestamps directly';
  END IF;
  IF OLD.cancel_at_period_end IS DISTINCT FROM NEW.cancel_at_period_end THEN
    RAISE EXCEPTION 'Cannot modify cancel_at_period_end directly';
  END IF;
  IF OLD.grace_period_until IS DISTINCT FROM NEW.grace_period_until THEN
    RAISE EXCEPTION 'Cannot modify grace_period_until directly';
  END IF;
  IF OLD.trial_end IS DISTINCT FROM NEW.trial_end THEN
    RAISE EXCEPTION 'Cannot modify trial_end directly';
  END IF;
  IF OLD.referral_credit_cents IS DISTINCT FROM NEW.referral_credit_cents THEN
    RAISE EXCEPTION 'Cannot modify referral_credit_cents directly';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-create trigger (idempotent)
DROP TRIGGER IF EXISTS protect_billing_columns_trigger ON public.users;
CREATE TRIGGER protect_billing_columns_trigger
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_billing_columns();

GRANT EXECUTE ON FUNCTION public.protect_billing_columns() TO postgres;
GRANT EXECUTE ON FUNCTION public.protect_billing_columns() TO service_role;

-- ═══════════════════════════════════════════════════════════════
-- 3. FIX: Restrict INSERT policy on users
--    New users cannot insert with trend_active=true or
--    referral_credit_cents > 0 (prevents privilege escalation)
-- ═══════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Users can insert own row" ON public.users;

CREATE POLICY "users_insert_own_safe" ON public.users
  FOR INSERT WITH CHECK (
    auth.uid() = id
    AND trend_active = false
    AND COALESCE(referral_credit_cents, 0) = 0
  );

-- ═══════════════════════════════════════════════════════════════
-- 4. FIX: Harden referral tables RLS
-- ═══════════════════════════════════════════════════════════════

-- 4a. referral_codes: owner can read their own code, only system inserts
DROP POLICY IF EXISTS referral_codes_owner ON referral_codes;
DROP POLICY IF EXISTS referral_codes_select_owner ON referral_codes;
DROP POLICY IF EXISTS referral_codes_insert ON referral_codes;

CREATE POLICY referral_codes_select_owner ON referral_codes
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY referral_codes_insert_owner ON referral_codes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 4b. referrals: referrer or referred can read; NO direct user INSERT/UPDATE
--    Only service_role (Edge Functions) can insert and update
DROP POLICY IF EXISTS referrals_read ON referrals;
DROP POLICY IF EXISTS referrals_insert ON referrals;
DROP POLICY IF EXISTS referrals_update ON referrals;

CREATE POLICY referrals_read ON referrals
  FOR SELECT USING (auth.uid() = referrer_id OR auth.uid() = referred_id);

-- Remove overly permissive INSERT (was WITH CHECK (true))
-- Only service_role needs to insert referral rows (from webhook)
-- No user-level INSERT policy = only service_role can insert

-- Remove overly permissive UPDATE (was USING (true))
-- Only service_role needs to update referral rows (from webhook)
-- No user-level UPDATE policy = only service_role can update

-- 4c. payout_requests: owner can read; only system inserts
DROP POLICY IF EXISTS payout_requests_owner ON payout_requests;
DROP POLICY IF EXISTS payout_requests_insert ON payout_requests;

CREATE POLICY payout_requests_select_owner ON payout_requests
  FOR SELECT USING (auth.uid() = user_id);

-- No user INSERT/UPDATE on payout_requests — only service_role (Edge Functions)

-- ═══════════════════════════════════════════════════════════════
-- 5. ENSURE: stripe_events_processed / processed_events table hardened
--    RLS enabled, no user access (service_role only)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stripe_events_processed (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id      TEXT    NOT NULL,
    event_type    TEXT    NOT NULL,
    customer_id   TEXT,
    processed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT stripe_events_processed_event_id_key UNIQUE (event_id)
);

ALTER TABLE public.stripe_events_processed ENABLE ROW LEVEL SECURITY;

-- No user access policy
DROP POLICY IF EXISTS "No user access to stripe_events_processed" ON public.stripe_events_processed;
CREATE POLICY "No user access to stripe_events_processed"
  ON public.stripe_events_processed FOR ALL
  USING (false) WITH CHECK (false);

-- Service role full access
GRANT ALL ON public.stripe_events_processed TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.stripe_events_processed_id_seq TO service_role;

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_stripe_events_processed_event_id
    ON public.stripe_events_processed (event_id);

CREATE INDEX IF NOT EXISTS idx_stripe_events_processed_customer_id
    ON public.stripe_events_processed (customer_id);

-- ═══════════════════════════════════════════════════════════════
-- 6. GRANT service_role full access to referral tables
-- ═══════════════════════════════════════════════════════════════
GRANT ALL ON public.referral_codes TO service_role;
GRANT ALL ON public.referrals TO service_role;
GRANT ALL ON public.payout_requests TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.referral_codes_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.referrals_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.payout_requests_id_seq TO service_role;

-- ═══════════════════════════════════════════════════════════════
-- 7. Cleanup: auto-purge old events (run manually or via pg_cron)
-- ═══════════════════════════════════════════════════════════════
-- DELETE FROM stripe_events_processed WHERE processed_at < now() - interval '30 days';

-- ============================================================
-- END OF MIGRATION
-- ============================================================
