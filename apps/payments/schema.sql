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
