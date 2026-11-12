CREATE TABLE IF NOT EXISTS orders (
 id uuid PRIMARY KEY, customer_id text NOT NULL, checkout_key uuid NOT NULL, fingerprint text NOT NULL,
 restaurant_id text NOT NULL, quote jsonb NOT NULL, address jsonb NOT NULL,
 order_state text NOT NULL CHECK(order_state IN ('PLACED','CANCELLED')),
 payment_state text NOT NULL CHECK(payment_state IN ('UNPAID','PAID','REFUNDED')),
 delivery_state text NOT NULL CHECK(delivery_state IN ('UNASSIGNED','ASSIGNED','DELIVERED')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(customer_id,checkout_key)
);
CREATE INDEX IF NOT EXISTS orders_by_customer ON orders(customer_id,created_at DESC);
CREATE TABLE IF NOT EXISTS order_events (
 id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES orders(id), kind text NOT NULL,
 actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS outbox (
 event_id uuid PRIMARY KEY REFERENCES order_events(id), attempts int NOT NULL DEFAULT 0,
 next_attempt timestamptz NOT NULL DEFAULT now(), processed_at timestamptz
);
CREATE TABLE IF NOT EXISTS order_activity (
 event_id uuid PRIMARY KEY, order_id uuid NOT NULL, kind text NOT NULL, occurred_at timestamptz NOT NULL
);

-- Snapshots remain purchase-time facts even if catalog or customer details change later.
CREATE OR REPLACE FUNCTION protect_order_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['order_state','payment_state','delivery_state'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['order_state','payment_state','delivery_state']) THEN
    RAISE EXCEPTION 'order snapshot is immutable';
  END IF;
  IF NEW.order_state <> OLD.order_state AND NOT
    (OLD.order_state='PLACED' AND NEW.order_state='CANCELLED' AND OLD.payment_state='UNPAID' AND OLD.delivery_state='UNASSIGNED') THEN
    RAISE EXCEPTION 'invalid order transition';
  END IF;
  IF NEW.payment_state <> OLD.payment_state AND NOT
    ((OLD.payment_state='UNPAID' AND NEW.payment_state='PAID' AND NEW.order_state='PLACED') OR
     (OLD.payment_state='PAID' AND NEW.payment_state='REFUNDED' AND NEW.delivery_state='UNASSIGNED')) THEN
    RAISE EXCEPTION 'invalid payment transition';
  END IF;
  IF NEW.delivery_state <> OLD.delivery_state AND NOT
    (NEW.order_state='PLACED' AND NEW.payment_state='PAID' AND
     ((OLD.delivery_state='UNASSIGNED' AND NEW.delivery_state='ASSIGNED') OR
      (OLD.delivery_state='ASSIGNED' AND NEW.delivery_state IN ('PICKED_UP','FAILED')) OR
      (OLD.delivery_state='PICKED_UP' AND NEW.delivery_state IN ('DELIVERED','FAILED')))) THEN
    RAISE EXCEPTION 'invalid delivery transition';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER order_transition BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION protect_order_transition();

CREATE TABLE IF NOT EXISTS order_payment_reservations (
 attempt_id uuid PRIMARY KEY,
 order_id uuid NOT NULL REFERENCES orders(id),
 status text NOT NULL CHECK(status IN ('OPEN','SUCCEEDED','FAILED','ABANDONED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_payment_per_order ON order_payment_reservations(order_id) WHERE status='OPEN';

CREATE TABLE IF NOT EXISTS kitchen_tickets (
 order_id uuid PRIMARY KEY REFERENCES orders(id),
 restaurant_id text NOT NULL,
 state text NOT NULL DEFAULT 'NEW' CHECK(state IN ('NEW','ACCEPTED','PREPARING','READY','REJECTED','EXPIRED')),
 deadline timestamptz NOT NULL, estimate_minutes int CHECK(estimate_minutes BETWEEN 1 AND 180),
 reason text, accepted_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kitchen_queue ON kitchen_tickets(restaurant_id,state,deadline);
CREATE TABLE IF NOT EXISTS restaurant_alerts (
 event_id uuid PRIMARY KEY REFERENCES order_events(id), order_id uuid NOT NULL REFERENCES kitchen_tickets(order_id),
 restaurant_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS payment_recovery (
 order_id uuid PRIMARY KEY REFERENCES orders(id), reason text NOT NULL,
 status text NOT NULL DEFAULT 'REFUND_PENDING', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION require_ready_for_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.delivery_state='UNASSIGNED' AND NEW.delivery_state='ASSIGNED' AND NOT EXISTS
   (SELECT 1 FROM kitchen_tickets WHERE order_id=NEW.id AND state='READY') THEN
   RAISE EXCEPTION 'restaurant must mark order ready before dispatch';
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER require_ready BEFORE UPDATE OF delivery_state ON orders
FOR EACH ROW EXECUTE FUNCTION require_ready_for_assignment();
CREATE TABLE IF NOT EXISTS order_dispatch (
 order_id uuid PRIMARY KEY REFERENCES orders(id),
 state text NOT NULL CHECK(state IN ('SEARCHING','NEEDS_ATTENTION','ASSIGNED')),
 driver_id text, offer_id uuid UNIQUE,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((state='ASSIGNED')=(driver_id IS NOT NULL AND offer_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS order_one_driver ON order_dispatch(driver_id) WHERE state='ASSIGNED';

-- Day 11 additive delivery metadata; retain immutable order/assignment history.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_delivery_state_check;
ALTER TABLE orders ADD CONSTRAINT orders_delivery_state_check CHECK(delivery_state IN ('UNASSIGNED','ASSIGNED','PICKED_UP','DELIVERED','FAILED'));
ALTER TABLE order_dispatch ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
UPDATE order_dispatch d SET active=false FROM orders o WHERE o.id=d.order_id AND o.delivery_state IN ('DELIVERED','FAILED');
DROP INDEX IF EXISTS order_one_driver;
CREATE UNIQUE INDEX order_one_driver ON order_dispatch(driver_id) WHERE state='ASSIGNED' AND active;
CREATE TABLE IF NOT EXISTS delivery_confirmations (
 order_id uuid PRIMARY KEY REFERENCES orders(id), nonce text NOT NULL,
 attempts integer NOT NULL DEFAULT 0, locked_until timestamptz,
 picked_up_at timestamptz, completed_at timestamptz, issue text, resolution text
);
