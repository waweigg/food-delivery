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
