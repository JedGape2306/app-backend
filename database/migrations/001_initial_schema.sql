CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE order_status AS ENUM (
  'pendiente_pago',
  'pagado',
  'en_preparacion',
  'listo',
  'en_camino',
  'entregado',
  'cancelado'
);

CREATE TYPE order_type AS ENUM (
  'delivery',
  'pickup'
);

CREATE TYPE payment_method_type AS ENUM (
  'card',
  'oxxo',
  'transfer',
  'cash'
);

CREATE TYPE payment_status AS ENUM (
  'pendiente',
  'aprobado',
  'rechazado',
  'reembolsado'
);

CREATE TABLE branches (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(100) NOT NULL,
  address     TEXT NOT NULL,
  phone       VARCHAR(20),
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE categories (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(100) NOT NULL,
  description TEXT,
  image_url   TEXT,
  sort_order  INTEGER DEFAULT 0,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE products (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  name        VARCHAR(150) NOT NULL,
  description TEXT,
  image_url   TEXT,
  is_active   BOOLEAN DEFAULT TRUE,
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE product_variants (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name        VARCHAR(50) NOT NULL,
  size_cm     INTEGER,
  price       NUMERIC(10,2) NOT NULL,
  is_active   BOOLEAN DEFAULT TRUE,
  sort_order  INTEGER DEFAULT 0
);

CREATE TABLE ingredients (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(100) NOT NULL,
  price       NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_active   BOOLEAN DEFAULT TRUE
);

CREATE TABLE delivery_persons (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id     UUID REFERENCES branches(id) ON DELETE SET NULL,
  name          VARCHAR(100) NOT NULL,
  phone         VARCHAR(20) NOT NULL,
  is_available  BOOLEAN DEFAULT TRUE,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE orders (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number          SERIAL UNIQUE,
  customer_name         VARCHAR(150) NOT NULL,
  customer_phone        VARCHAR(20) NOT NULL,
  customer_email        VARCHAR(200),
  address_street        VARCHAR(255),
  address_neighborhood  VARCHAR(150),
  address_city          VARCHAR(100),
  address_zip_code      VARCHAR(10),
  address_references    TEXT,
  latitude              NUMERIC(10,7),
  longitude             NUMERIC(10,7),
  order_type            order_type NOT NULL,
  status                order_status NOT NULL DEFAULT 'pendiente_pago',
  subtotal              NUMERIC(10,2) NOT NULL,
  delivery_fee          NUMERIC(10,2) NOT NULL DEFAULT 0,
  discount              NUMERIC(10,2) NOT NULL DEFAULT 0,
  total                 NUMERIC(10,2) NOT NULL,
  payment_method        payment_method_type,
  payment_id            VARCHAR(255),
  branch_id             UUID REFERENCES branches(id) ON DELETE SET NULL,
  delivery_person_id    UUID REFERENCES delivery_persons(id) ON DELETE SET NULL,
  notes                 TEXT,
  estimated_delivery_at TIMESTAMP WITH TIME ZONE,
  delivered_at          TIMESTAMP WITH TIME ZONE,
  created_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER SEQUENCE orders_order_number_seq RESTART WITH 1001;

CREATE TABLE order_items (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id    UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  variant_id    UUID NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  product_name  VARCHAR(150) NOT NULL,
  variant_name  VARCHAR(50) NOT NULL,
  unit_price    NUMERIC(10,2) NOT NULL,
  quantity      INTEGER NOT NULL DEFAULT 1,
  subtotal      NUMERIC(10,2) NOT NULL,
  notes         TEXT
);

CREATE TABLE order_item_extras (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_item_id   UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  ingredient_id   UUID NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
  ingredient_name VARCHAR(100) NOT NULL,
  unit_price      NUMERIC(10,2) NOT NULL,
  quantity        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE payments (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id                 UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  gateway                  VARCHAR(50) NOT NULL DEFAULT 'stripe',
  stripe_session_id        VARCHAR(255),
  stripe_payment_intent_id VARCHAR(255),
  status                   payment_status NOT NULL DEFAULT 'pendiente',
  amount                   NUMERIC(10,2) NOT NULL,
  currency                 VARCHAR(3) DEFAULT 'MXN',
  payment_method           payment_method_type,
  raw_response             JSONB,
  paid_at                  TIMESTAMP WITH TIME ZONE,
  created_at               TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at               TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE order_status_history (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  previous_status order_status,
  new_status      order_status NOT NULL,
  changed_by      VARCHAR(100) DEFAULT 'system',
  notes           TEXT,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE admin_users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id     UUID REFERENCES branches(id) ON DELETE SET NULL,
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(200) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          VARCHAR(30) NOT NULL DEFAULT 'staff',
  is_active     BOOLEAN DEFAULT TRUE,
  last_login_at TIMESTAMP WITH TIME ZONE,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_orders_status        ON orders(status);
CREATE INDEX idx_orders_branch_id     ON orders(branch_id);
CREATE INDEX idx_orders_created_at    ON orders(created_at DESC);
CREATE INDEX idx_orders_phone         ON orders(customer_phone);
CREATE INDEX idx_orders_payment_id    ON orders(payment_id);
CREATE INDEX idx_order_items_order    ON order_items(order_id);
CREATE INDEX idx_products_category    ON products(category_id);
CREATE INDEX idx_products_active      ON products(is_active);
CREATE INDEX idx_payments_order       ON payments(order_id);
CREATE INDEX idx_payments_session     ON payments(stripe_session_id);
CREATE INDEX idx_status_history_order ON order_status_history(order_id);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE FUNCTION log_order_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO order_status_history (order_id, previous_status, new_status, changed_by)
    VALUES (NEW.id, OLD.status, NEW.status, 'system');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_order_status_history
  AFTER UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION log_order_status_change();

INSERT INTO branches (id, name, address, phone) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Sucursal Principal', 'Av. Principal #123, Centro', '444-000-0001');

INSERT INTO categories (id, name, sort_order) VALUES
  ('00000000-0000-0000-0000-000000000010', 'Pizzas', 1),
  ('00000000-0000-0000-0000-000000000011', 'Bebidas', 2),
  ('00000000-0000-0000-0000-000000000012', 'Extras', 3);

INSERT INTO products (id, category_id, name, description, sort_order) VALUES
  ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000010', 'Pizza Margarita', 'Salsa de tomate, mozzarella y albahaca', 1),
  ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000010', 'Pizza Hawaiana', 'Jamón, piña y mozzarella', 2),
  ('00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000010', 'Pizza Pepperoni', 'Pepperoni y mozzarella', 3);

INSERT INTO product_variants (id, product_id, name, size_cm, price, sort_order) VALUES
  ('00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000020', 'Chica', 25, 120.00, 1),
  ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000020', 'Mediana', 30, 165.00, 2),
  ('00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-000000000020', 'Grande', 40, 220.00, 3),
  ('00000000-0000-0000-0000-000000000033', '00000000-0000-0000-0000-000000000021', 'Chica', 25, 130.00, 1),
  ('00000000-0000-0000-0000-000000000034', '00000000-0000-0000-0000-000000000021', 'Mediana', 30, 175.00, 2),
  ('00000000-0000-0000-0000-000000000035', '00000000-0000-0000-0000-000000000021', 'Grande', 40, 235.00, 3),
  ('00000000-0000-0000-0000-000000000036', '00000000-0000-0000-0000-000000000022', 'Chica', 25, 135.00, 1),
  ('00000000-0000-0000-0000-000000000037', '00000000-0000-0000-0000-000000000022', 'Mediana', 30, 180.00, 2),
  ('00000000-0000-0000-0000-000000000038', '00000000-0000-0000-0000-000000000022', 'Grande', 40, 245.00, 3);

INSERT INTO ingredients (name, price) VALUES
  ('Queso extra', 25.00),
  ('Jamón', 20.00),
  ('Pepperoni', 20.00),
  ('Champiñones', 15.00),
  ('Chile jalapeño', 10.00),
  ('Aceitunas', 15.00),
  ('Cebolla', 10.00),
  ('Pimiento', 10.00);

INSERT INTO admin_users (branch_id, name, email, password_hash, role) VALUES
  ('00000000-0000-0000-0000-000000000001',
   'Administrador',
   'admin@pizzeria.com',
   '$2b$12$PLACEHOLDER_HASH_CHANGE_ME_BEFORE_PROD',
   'superadmin');