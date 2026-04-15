-- Grace period expiry: server-side enforcement
-- Run every hour via pg_cron (if available) or manually
CREATE OR REPLACE FUNCTION expire_grace_periods()
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE users
  SET trend_active = false
  WHERE grace_period_until IS NOT NULL
    AND grace_period_until < now()
    AND trend_active = true;
$$;

-- If pg_cron extension is available:
-- SELECT cron.schedule('expire-grace-periods', '0 * * * *', 'SELECT expire_grace_periods();');
