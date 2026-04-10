-- Auto top-up is always on — flip existing canisters and change the default.
UPDATE canisters SET auto_topup = true WHERE auto_topup = false OR auto_topup IS NULL;
ALTER TABLE canisters ALTER COLUMN auto_topup SET DEFAULT true;
