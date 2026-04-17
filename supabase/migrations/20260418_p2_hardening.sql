-- ============================================================
-- Iron Kinetic — Backend Hardening P2 Migration
-- Date: 2026-04-18
-- Purpose: Session management, GDPR delete, audit logging,
--          payout logging, rate limiting infrastructure.
-- ============================================================

-- ═══════════════════════════════════════════════════════════════
-- 1. payout_log: track all completed payouts for audit
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.payout_log (
    id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id             UUID NOT NULL,
    amount_cents        INT NOT NULL,
    stripe_transfer_id  TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.payout_log ENABLE ROW LEVEL SECURITY;

-- Users can read only their own payout logs
CREATE POLICY "payout_log_select_own" ON public.payout_log
    FOR SELECT USING (auth.uid() = user_id);

-- No user INSERT/UPDATE — service_role only
GRANT ALL ON public.payout_log TO service_role;

CREATE INDEX IF NOT EXISTS idx_payout_log_user_id ON public.payout_log (user_id);
CREATE INDEX IF NOT EXISTS idx_payout_log_created_at ON public.payout_log (created_at);

-- ═══════════════════════════════════════════════════════════════
-- 2. audit_log: generic audit trail for critical operations
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.audit_log (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id     UUID,
    action      TEXT NOT NULL,
    metadata    JSONB,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- No user access — service_role only (Edge Functions write with SERVICE_ROLE_KEY)
-- Intentionally NO policy for user access
GRANT ALL ON public.audit_log TO service_role;

CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON public.audit_log (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON public.audit_log (action);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON public.audit_log (created_at);

-- ═══════════════════════════════════════════════════════════════
-- 3. rate_limits: centralized rate limit tracking (future use)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.rate_limits (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id     UUID NOT NULL,
    action      TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- No user access — service_role only
GRANT ALL ON public.rate_limits TO service_role;

CREATE INDEX IF NOT EXISTS idx_rate_limits_user_action ON public.rate_limits (user_id, action);
CREATE INDEX IF NOT EXISTS idx_rate_limits_created_at ON public.rate_limits (created_at);

-- Auto-purge old entries (older than 1 hour)
CREATE OR REPLACE FUNCTION public.cleanup_rate_limits()
RETURNS void AS $$
BEGIN
    DELETE FROM public.rate_limits WHERE created_at < NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- END OF MIGRATION
-- ============================================================
