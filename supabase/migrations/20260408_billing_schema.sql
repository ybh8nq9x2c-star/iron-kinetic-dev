-- ============================================================
-- Iron Kinetic — Billing Schema Migration
-- Date: 2026-04-08
-- Purpose: Idempotent setup of billing infrastructure
--   1) Ensures all required columns exist on `users`
--   2) Creates `processed_events` for Stripe webhook idempotency
--   3) Creates useful indexes for billing queries
--   4) NO destructive operations — safe to re-run
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- 1. USERS TABLE — ensure billing columns exist
--    (all ADD COLUMN ... IF NOT EXISTS for idempotency)
-- ════════════════════════════════════════════════════════════

-- Primary key + auth reference (should already exist from auth.users link)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS id UUID PRIMARY KEY DEFAULT gen_random_uuid();

-- Email for Stripe customer matching
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS email TEXT;

-- Whether the user has active paid Trend access
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS trend_active BOOLEAN NOT NULL DEFAULT false;

-- Trial end timestamp — defaults to 7 days from creation
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS trial_end TIMESTAMPTZ
    DEFAULT (now() + '7 days'::interval);

-- Subscription plan: 'free' | 'monthly' | 'annual' | 'lifetime'
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';

-- Stripe Customer ID (set on first checkout)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

-- Creation timestamp
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ── NEW: Stripe Subscription ID for recurring billing ──
-- Allows tracking the specific subscription object (not just customer)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

-- ── NEW: Current billing period bounds ──
-- Useful for grace period calculation and UI display
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS current_period_start TIMESTAMPTZ;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;

-- ── NEW: Cancel at period end flag ──
-- True when user cancelled but still has access until period ends
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT false;

-- ── NEW: Grace period tracking ──
-- Set when payment_failed occurs; null when healthy
-- Webhook should set this to now() on first failure, null on success
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS grace_period_until TIMESTAMPTZ;

-- ════════════════════════════════════════════════════════════
-- 2. PROCESSED_EVENTS — Stripe webhook idempotency
--    Stores every successfully processed Stripe event.id
--    to prevent duplicate processing on retry
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.processed_events (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id      TEXT    NOT NULL UNIQUE,  -- Stripe evt_xxx
    event_type    TEXT    NOT NULL,          -- e.g. checkout.session.completed
    customer_id   TEXT,                      -- Stripe cus_xxx (nullable for non-customer events)
    processed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Prevent duplicate event processing at DB level
    CONSTRAINT processed_events_event_id_key UNIQUE (event_id)
);

-- Fast lookup: is this event already processed?
CREATE INDEX IF NOT EXISTS idx_processed_events_event_id
    ON public.processed_events (event_id);

-- Fast lookup: recent events for a customer
CREATE INDEX IF NOT EXISTS idx_processed_events_customer_id
    ON public.processed_events (customer_id);

-- ════════════════════════════════════════════════════════════
-- 3. INDEXES on users for billing queries
-- ════════════════════════════════════════════════════════════

-- Webhook looks up users by stripe_customer_id
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id
    ON public.users (stripe_customer_id)
    WHERE stripe_customer_id IS NOT NULL;

-- Find expired trials (for cleanup/cron)
CREATE INDEX IF NOT EXISTS idx_users_trial_end
    ON public.users (trial_end)
    WHERE trend_active = false;

-- Find subscriptions nearing end of period
CREATE INDEX IF NOT EXISTS idx_users_current_period_end
    ON public.users (current_period_end)
    WHERE current_period_end IS NOT NULL;

-- ════════════════════════════════════════════════════════════
-- 4. RLS (Row Level Security) policies
--    Users can only read/update their own row
-- ════════════════════════════════════════════════════════════

-- Enable RLS on both tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processed_events ENABLE ROW LEVEL SECURITY;

-- Users can read their own row (needed for checkTrendAccess)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'users'
          AND policyname = 'Users can read own row'
    ) THEN
        CREATE POLICY "Users can read own row"
            ON public.users FOR SELECT
            USING (auth.uid() = id);
    END IF;
END $$;

-- Users can update their own row (for syncUserAfterLogin upsert)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'users'
          AND policyname = 'Users can update own row'
    ) THEN
        CREATE POLICY "Users can update own row"
            ON public.users FOR UPDATE
            USING (auth.uid() = id);
    END IF;
END $$;

-- Users can insert their own row (for signup sync)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'users'
          AND policyname = 'Users can insert own row'
    ) THEN
        CREATE POLICY "Users can insert own row"
            ON public.users FOR INSERT
            WITH CHECK (auth.uid() = id);
    END IF;
END $$;

-- processed_events: no direct user access (only service role writes)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'processed_events'
          AND policyname = 'No user access to processed_events'
    ) THEN
        CREATE POLICY "No user access to processed_events"
            ON public.processed_events FOR ALL
            USING (false) WITH CHECK (false);
    END IF;
END $$;

-- ════════════════════════════════════════════════════════════
-- 5. GRANT service role full access to processed_events
-- ════════════════════════════════════════════════════════════

-- Service role (used by Edge Functions) needs full access
GRANT ALL ON public.processed_events TO service_role;
GRANT ALL ON public.users TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.processed_events_id_seq TO service_role;

-- ════════════════════════════════════════════════════════════
-- 6. CLEANUP: auto-purge processed_events older than 30 days
--    (optional but recommended for table bloat prevention)
-- ════════════════════════════════════════════════════════════

-- This can be called from a pg_cron job or Supabase Edge Function:
-- DELETE FROM processed_events WHERE processed_at < now() - interval '30 days';

-- ============================================================
-- END OF MIGRATION
-- ============================================================
