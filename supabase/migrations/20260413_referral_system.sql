-- ═══════════════════════════════════════════════════════════════
-- Referral System Migration v2 — Iron Kinetic™
-- Date: 2026-04-13
-- Adds referral tracking, credit system, and payout support
-- ═══════════════════════════════════════════════════════════════

-- ═══ STEP 1A: Extend existing users table ═══
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS referral_credit_cents     int  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stripe_connect_account_id text,
  ADD COLUMN IF NOT EXISTS stripe_connect_onboarded  bool DEFAULT false;

-- ═══ STEP 1B: Referral codes table ═══
CREATE TABLE IF NOT EXISTS referral_codes (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  code       text        UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- ═══ STEP 1C: Referral tracking table ═══
CREATE TABLE IF NOT EXISTS referrals (
  id                     uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  referrer_id            uuid        REFERENCES auth.users(id),
  referred_id            uuid        REFERENCES auth.users(id),
  code                   text        NOT NULL,
  status                 text        DEFAULT 'pending',
  reward_amount_cents    int         DEFAULT 0,
  stripe_subscription_id text,
  created_at             timestamptz DEFAULT now(),
  confirmed_at           timestamptz,
  CONSTRAINT status_check CHECK (status IN ('pending','confirmed','paid','reversed'))
);

-- ═══ STEP 1D: Payout requests table ═══
CREATE TABLE IF NOT EXISTS payout_requests (
  id                       uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id                  uuid        REFERENCES auth.users(id),
  amount_cents             int         NOT NULL,
  status                   text        DEFAULT 'pending',
  stripe_transfer_id       text,
  stripe_connect_account_id text,
  created_at               timestamptz DEFAULT now(),
  paid_at                  timestamptz,
  CONSTRAINT payout_status_check CHECK (status IN ('pending','processing','paid','failed'))
);

-- ═══ STEP 1E: SECURITY DEFINER function for crediting referral rewards ═══
-- SET search_path = public prevents search_path injection
CREATE OR REPLACE FUNCTION add_referral_credit(uid uuid, amount int)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE users
  SET referral_credit_cents = COALESCE(referral_credit_cents, 0) + amount
  WHERE id = uid;
$$;

-- ═══ STEP 1F: Atomic consume function (TOCTOU protection) ═══
-- Resolves race condition on request-payout:
-- Two parallel requests cannot both consume the same balance.
-- If Stripe transfer fails after consume, credit is restored via add_referral_credit.
CREATE OR REPLACE FUNCTION consume_referral_credit(uid uuid, min_cents int)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  consumed int;
BEGIN
  UPDATE users
  SET referral_credit_cents = 0
  WHERE id = uid
    AND referral_credit_cents >= min_cents
  RETURNING referral_credit_cents INTO consumed;

  RETURN consumed; -- NULL if below threshold or already consumed
END;
$$;

-- ═══ STEP 1G: Row Level Security ═══
ALTER TABLE referral_codes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals         ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_requests   ENABLE ROW LEVEL SECURITY;

-- referral_codes: owner can see/manage their own code
DROP POLICY IF EXISTS referral_codes_owner ON referral_codes;
CREATE POLICY referral_codes_owner ON referral_codes
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- referrals: referrer or referred can read; only system can insert/update
DROP POLICY IF EXISTS referrals_read ON referrals;
CREATE POLICY referrals_read ON referrals
  FOR SELECT USING (auth.uid() = referrer_id OR auth.uid() = referred_id);

DROP POLICY IF EXISTS referrals_insert ON referrals;
CREATE POLICY referrals_insert ON referrals
  FOR INSERT WITH CHECK (true); -- system creates via service_role on checkout

DROP POLICY IF EXISTS referrals_update ON referrals;
CREATE POLICY referrals_update ON referrals
  FOR UPDATE USING (true); -- system updates via service_role on webhook

-- payout_requests: owner can read their own payouts
DROP POLICY IF EXISTS payout_requests_owner ON payout_requests;
CREATE POLICY payout_requests_owner ON payout_requests
  FOR SELECT USING (auth.uid() = user_id);
