-- ============================================================
-- Iron Kinetic — Backend Fixes Migration
-- Date: 2026-04-21
-- Purpose: Fix email protection, service_role bypass, INSERT policy,
--          drop duplicate table, idempotent policies
-- ============================================================

-- ═══════════════════════════════════════════════════════════════
-- FIX 1: Add email to protect_billing_columns trigger
-- Prevents account hijacking via email collision
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.protect_billing_columns()
RETURNS TRIGGER AS $$
BEGIN
  -- Robust service_role bypass: check multiple indicators
  -- Edge Functions with service_role key may not set request.jwt.claim.role
  IF current_setting('role', true) = 'service_role'
     OR current_setting('request.jwt.claim.role', true) = 'service_role'
     OR current_user = 'postgres'
  THEN
    RETURN NEW;
  END IF;

  -- Block changes to billing/sensitive columns
  IF OLD.email IS DISTINCT FROM NEW.email THEN
    RAISE EXCEPTION 'Cannot modify email directly';
  END IF;
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

-- ═══════════════════════════════════════════════════════════════
-- FIX 3: Harden INSERT policy — add plan IS NULL restriction
-- Prevents users from inserting with plan pre-set
-- ═══════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "users_insert_own_safe" ON public.users;
CREATE POLICY "users_insert_own_safe" ON public.users
  FOR INSERT WITH CHECK (
    auth.uid() = id
    AND trend_active = false
    AND COALESCE(referral_credit_cents, 0) = 0
    AND plan IS NULL
  );

-- ═══════════════════════════════════════════════════════════════
-- FIX 4: Drop duplicate/unused stripe_events_processed table
-- processed_events is the actively used table
-- ═══════════════════════════════════════════════════════════════
DROP TABLE IF EXISTS public.stripe_events_processed CASCADE;

-- ═══════════════════════════════════════════════════════════════
-- FIX 9: Make 20260416 policies idempotent (safe re-run)
-- These are wrapped to prevent duplicate_object errors
-- ═══════════════════════════════════════════════════════════════
DO $$ BEGIN
  CREATE POLICY "Users can read own row"
    ON public.users FOR SELECT USING (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can insert own row"
    ON public.users FOR INSERT WITH CHECK (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role full access"
    ON public.users FOR ALL USING (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- END OF MIGRATION
-- ============================================================
