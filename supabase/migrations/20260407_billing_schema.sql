-- Iron Kinetic: Full billing schema migration
-- Run this in Supabase SQL Editor

-- Extend users table with full billing fields
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free', 'monthly', 'annual', 'lifetime')),
  ADD COLUMN IF NOT EXISTS subscription_status TEXT
    CHECK (subscription_status IN (
      'active', 'trialing', 'past_due', 'canceled',
      'incomplete', 'incomplete_expired', 'unpaid'
    )),
  ADD COLUMN IF NOT EXISTS trial_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS trend_active BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Unique index on stripe_customer_id for fast webhook lookups
CREATE UNIQUE INDEX IF NOT EXISTS users_stripe_customer_id_idx
  ON public.users (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- Index for email lookups (fallback when supabase_uid not in metadata)
CREATE INDEX IF NOT EXISTS users_email_idx
  ON public.users (email)
  WHERE email IS NOT NULL;

-- Row Level Security: users can only read their own row
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Users read own row' AND tablename = 'users'
  ) THEN
    CREATE POLICY "Users read own row"
      ON public.users FOR SELECT
      USING (auth.uid() = id);
  END IF;
END $$;

-- Service role bypasses RLS automatically (used by Edge Functions with service role key)
