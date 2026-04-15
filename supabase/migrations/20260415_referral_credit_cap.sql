-- Cap referral credits at €500 (50000 cents)
CREATE OR REPLACE FUNCTION add_referral_credit(uid uuid, amount int)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE users
  SET referral_credit_cents = LEAST(COALESCE(referral_credit_cents, 0) + amount, 50000)
  WHERE id = uid;
$$;
