-- ============================================================
-- Iron Kinetic — Billing RLS Hardening
-- Purpose: Prevent client-side updates to billing/entitlement columns
-- Only service_role can modify billing fields
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- 1. Drop the overly broad UPDATE policy
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Users can update own row" ON public.users;

-- ════════════════════════════════════════════════════════════
-- 2. Replace with column-restricted UPDATE policy
--    Users can only update non-billing columns on their own row
-- ════════════════════════════════════════════════════════════
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
  );

-- ════════════════════════════════════════════════════════════
-- 3. Add BEFORE UPDATE trigger as belt-and-suspenders
--    Rejects any attempt to change billing columns from anon key context
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.protect_billing_columns()
RETURNS TRIGGER AS $$
BEGIN
  -- If the calling role is service_role, allow everything
  IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;
  
  -- For all other roles, prevent changes to billing columns
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
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS protect_billing_columns_trigger ON public.users;
CREATE TRIGGER protect_billing_columns_trigger
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_billing_columns();

-- Grant execute on the trigger function to postgres (owner)
GRANT EXECUTE ON FUNCTION public.protect_billing_columns() TO postgres;
GRANT EXECUTE ON FUNCTION public.protect_billing_columns() TO service_role;
