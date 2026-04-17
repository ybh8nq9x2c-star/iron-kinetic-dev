-- ══════════════════════════════════════════════════════════════
-- 20260417_subscription_verify.sql
-- Iron Kinetic: Server-side subscription verification support
-- ══════════════════════════════════════════════════════════════

-- Ensure trial_end column exists with proper default (idempotent)
-- If column already exists, this is a no-op
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'trial_end'
  ) THEN
    ALTER TABLE public.users ADD COLUMN trial_end timestamptz DEFAULT (now() + interval '7 days');
  END IF;
END $$;

-- Ensure grace_period_until column exists (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'grace_period_until'
  ) THEN
    ALTER TABLE public.users ADD COLUMN grace_period_until timestamptz;
  END IF;
END $$;

-- Index on trial_end for quick lookups by verify-subscription Edge Function
CREATE INDEX IF NOT EXISTS idx_users_trial_end ON public.users (trial_end);

-- Index on trend_active for quick filtering
CREATE INDEX IF EXISTS idx_users_trend_active ON public.users (trend_active) WHERE trend_active = true;

-- Ensure RLS is enabled on users table
ALTER TABLE public.users ENABLE ROW LEVEL AUTH;

-- Verify existing RLS policies are in place (these are idempotent)
-- Users can read own row
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Users can read own row'
  ) THEN
    CREATE POLICY "Users can read own row" ON public.users FOR SELECT USING (auth.uid() = id);
  END IF;
END $$;
