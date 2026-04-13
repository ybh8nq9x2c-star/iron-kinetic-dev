-- ═══════════════════════════════════════════════════════════════
-- Referral System Migration — Iron Kinetic™
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
CREATE OR REPLACE FUNCTION add_referral_credit(uid uuid, amount int)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE users
  SET referral_credit_cents = COALESCE(referral_credit_cents, 0) + amount
  WHERE id = uid;
$$;

-- ═══ STEP 1F: Row Level Security ═══
ALTER TABLE referral_codes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals         ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_requests   ENABLE ROW LEVEL SECURITY;

-- referral_codes: owner can see/manage their own code
DROP POLICY IF EXISTS "owner_referral_codes" ON referral_codes;
CREATE POLICY "owner_referral_codes"
  ON referral_codes FOR ALL
  USING (auth.uid() = user_id);

-- referrals: referrer sees their own referrals
DROP POLICY IF EXISTS "owner_referrals" ON referrals;
CREATE POLICY "owner_referrals"
  ON referrals FOR SELECT
  USING (auth.uid() = referrer_id);

-- payout_requests: owner sees their own requests
DROP POLICY IF EXISTS "owner_payout_requests" ON payout_requests;
CREATE POLICY "owner_payout_requests"
  ON payout_requests FOR SELECT
  USING (auth.uid() = user_id);

-- ═══ STEP 1G: Performance indexes ═══
CREATE INDEX IF NOT EXISTS idx_referral_codes_user_id ON referral_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_referral_codes_code    ON referral_codes(code);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer_id  ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred_id  ON referrals(referred_id);
CREATE INDEX IF NOT EXISTS idx_payout_user_id         ON payout_requests(user_id);
