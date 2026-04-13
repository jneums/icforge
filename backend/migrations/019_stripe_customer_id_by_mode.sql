-- Split stripe_customer_id into per-mode columns so switching between
-- sandbox (sk_test_) and live (sk_live_) keys doesn't clobber customer IDs.

ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id_live TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id_test TEXT;

-- Migrate existing customer IDs: since we just switched to live, the
-- existing stripe_customer_id (if any) could be either. We cleared stale
-- sandbox IDs already, so any remaining value is live.
UPDATE users
  SET stripe_customer_id_live = stripe_customer_id
  WHERE stripe_customer_id IS NOT NULL;
