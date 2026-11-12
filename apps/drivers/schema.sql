CREATE TABLE IF NOT EXISTS driver_profiles (
 user_id text PRIMARY KEY, name text NOT NULL, vehicle text NOT NULL,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED','SUSPENDED')),
 version integer NOT NULL DEFAULT 1, online boolean NOT NULL DEFAULT false,
 latitude double precision, longitude double precision, accuracy double precision,
 observed_at timestamptz, received_at timestamptz, heartbeat_at timestamptz,
 CHECK(latitude BETWEEN -90 AND 90), CHECK(longitude BETWEEN -180 AND 180),
 CHECK(accuracy BETWEEN 0 AND 100), CHECK(NOT online OR status='APPROVED')
);
CREATE TABLE IF NOT EXISTS driver_registrations (
 user_id text PRIMARY KEY REFERENCES driver_profiles(user_id),
 channel text NOT NULL CHECK(channel='foreground-poll'), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS driver_offers (
 id uuid PRIMARY KEY, order_id uuid NOT NULL, driver_id text NOT NULL REFERENCES driver_profiles(user_id),
 pickup text NOT NULL, expires_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','ACCEPTED','DECLINED','EXPIRED','COMPLETED')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_delivery ON driver_offers(driver_id) WHERE state='ACCEPTED';
CREATE UNIQUE INDEX IF NOT EXISTS one_active_order ON driver_offers(order_id) WHERE state IN ('PENDING','ACCEPTED');
CREATE TABLE IF NOT EXISTS driver_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor text NOT NULL, driver_id text NOT NULL,
 action text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dispatch_jobs (
 order_id uuid PRIMARY KEY, restaurant_id text NOT NULL,
 pickup text, latitude double precision, longitude double precision,
 state text NOT NULL DEFAULT 'SEARCHING' CHECK(state IN ('SEARCHING','RESERVED','ASSIGNED','NEEDS_ATTENTION')),
 attempts integer NOT NULL DEFAULT 0, round integer NOT NULL DEFAULT 1,
 deadline timestamptz NOT NULL, next_attempt timestamptz NOT NULL DEFAULT now(),
 offer_id uuid REFERENCES driver_offers(id), driver_id text,
 issue text, notified_state text, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE driver_offers ADD COLUMN IF NOT EXISTS dispatch_round integer;
CREATE INDEX IF NOT EXISTS dispatch_due ON dispatch_jobs(next_attempt);

ALTER TABLE dispatch_jobs DROP CONSTRAINT IF EXISTS dispatch_jobs_state_check;
ALTER TABLE dispatch_jobs ADD CONSTRAINT dispatch_jobs_state_check CHECK(state IN ('SEARCHING','RESERVED','ASSIGNED','PICKED_UP','DELIVERED','FAILED','NEEDS_ATTENTION'));
