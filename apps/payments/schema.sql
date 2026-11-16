CREATE TABLE IF NOT EXISTS attempts(
 id uuid PRIMARY KEY, order_id uuid NOT NULL, owner_id text NOT NULL,
 amount bigint NOT NULL CHECK(amount>0), currency text NOT NULL CHECK(currency='INR'),
 provider text NOT NULL, reference text UNIQUE, status text NOT NULL DEFAULT 'PENDING'
 CHECK(status IN ('PENDING','SUCCEEDED','FAILED','ABANDONED')),
 synchronized boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
 reserved boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX IF NOT EXISTS exclusive_payment ON attempts(order_id)
 WHERE status IN ('PENDING','SUCCEEDED') OR NOT synchronized;
CREATE TABLE IF NOT EXISTS provider_events(
 provider text NOT NULL,event_id text NOT NULL,received_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(provider,event_id)
);
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS last_checked timestamptz;

CREATE TABLE IF NOT EXISTS refunds (
 id uuid PRIMARY KEY, attempt_id uuid NOT NULL UNIQUE REFERENCES attempts(id),
 journal_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 amount bigint NOT NULL CHECK(amount>0), reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 500),
 admin_id text NOT NULL, status text NOT NULL DEFAULT 'PENDING'
   CHECK(status IN ('PENDING','SUCCEEDED','FAILED')),
 provider_reference text, last_error text, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS journal_id uuid;
UPDATE refunds SET journal_id=gen_random_uuid() WHERE journal_id IS NULL;
ALTER TABLE refunds ALTER COLUMN journal_id SET DEFAULT gen_random_uuid();
ALTER TABLE refunds ALTER COLUMN journal_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS refunds_journal_id ON refunds(journal_id);
CREATE TABLE IF NOT EXISTS ledger_entries (
 id uuid PRIMARY KEY, journal_id uuid NOT NULL, order_id uuid NOT NULL,
 attempt_id uuid NOT NULL REFERENCES attempts(id), refund_id uuid REFERENCES refunds(id),
 account text NOT NULL CHECK(account IN ('PROCESSOR_CLEARING','CUSTOMER_FUNDS_HELD')),
 amount bigint NOT NULL CHECK(amount<>0), currency text NOT NULL CHECK(currency='INR'),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_once_per_journal_account
 ON ledger_entries(journal_id,account);
CREATE INDEX IF NOT EXISTS ledger_by_order ON ledger_entries(order_id,created_at);
INSERT INTO ledger_entries(id,journal_id,order_id,attempt_id,account,amount,currency,created_at)
 SELECT gen_random_uuid(),a.id,a.order_id,a.id,'PROCESSOR_CLEARING',a.amount,a.currency,a.created_at
 FROM attempts a WHERE a.status='SUCCEEDED' AND a.synchronized
 ON CONFLICT DO NOTHING;
INSERT INTO ledger_entries(id,journal_id,order_id,attempt_id,account,amount,currency,created_at)
 SELECT gen_random_uuid(),a.id,a.order_id,a.id,'CUSTOMER_FUNDS_HELD',-a.amount,a.currency,a.created_at
 FROM attempts a WHERE a.status='SUCCEEDED' AND a.synchronized
 ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS settlements(attempt_id uuid PRIMARY KEY REFERENCES attempts(id),restaurant_id text NOT NULL,driver_id text NOT NULL,restaurant_minor bigint NOT NULL CHECK(restaurant_minor>=0),driver_minor bigint NOT NULL CHECK(driver_minor>=0),platform_minor bigint NOT NULL CHECK(platform_minor>=0),actor text NOT NULL,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS test_payouts(attempt_id uuid NOT NULL REFERENCES settlements(attempt_id),beneficiary text NOT NULL CHECK(beneficiary IN ('restaurant','driver')),reference text NOT NULL UNIQUE,actor text NOT NULL,reason text NOT NULL,amount bigint NOT NULL CHECK(amount>0),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(attempt_id,beneficiary));

CREATE TABLE IF NOT EXISTS settlement_journal(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),attempt_id uuid NOT NULL REFERENCES settlements(attempt_id),account text NOT NULL,amount bigint NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE OR REPLACE FUNCTION post_settlement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
INSERT INTO settlement_journal(attempt_id,account,amount) VALUES(NEW.attempt_id,'HELD_FUNDS',NEW.restaurant_minor+NEW.driver_minor+NEW.platform_minor),(NEW.attempt_id,'RESTAURANT',-NEW.restaurant_minor),(NEW.attempt_id,'DRIVER',-NEW.driver_minor),(NEW.attempt_id,'PLATFORM',-NEW.platform_minor); RETURN NEW; END $$;
CREATE OR REPLACE TRIGGER settlement_post AFTER INSERT ON settlements FOR EACH ROW EXECUTE FUNCTION post_settlement();
CREATE OR REPLACE FUNCTION post_test_payout() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
INSERT INTO settlement_journal(attempt_id,account,amount) VALUES(NEW.attempt_id,upper(NEW.beneficiary),NEW.amount),(NEW.attempt_id,'SIMULATED_PAYOUT',-NEW.amount); RETURN NEW; END $$;
CREATE OR REPLACE TRIGGER payout_post AFTER INSERT ON test_payouts FOR EACH ROW EXECUTE FUNCTION post_test_payout();
CREATE OR REPLACE FUNCTION immutable_settlement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Settlement history is append only'; END $$;
CREATE OR REPLACE TRIGGER settlement_immutable BEFORE UPDATE OR DELETE ON settlements FOR EACH ROW EXECUTE FUNCTION immutable_settlement();
CREATE OR REPLACE TRIGGER payout_immutable BEFORE UPDATE OR DELETE ON test_payouts FOR EACH ROW EXECUTE FUNCTION immutable_settlement();
CREATE OR REPLACE TRIGGER settlement_journal_immutable BEFORE UPDATE OR DELETE ON settlement_journal FOR EACH ROW EXECUTE FUNCTION immutable_settlement();
