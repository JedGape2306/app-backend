-- ============================================================
-- FIX: Reemplaza los seed data con UUIDs reales válidos
-- Ejecutar DESPUÉS de 001_initial_schema.sql
-- ============================================================

DELETE FROM order_item_extras;
DELETE FROM order_items;
DELETE FROM order_status_history;
DELETE FROM payments;
DELETE FROM orders;
DELETE FROM product_variants;
DELETE FROM products;
DELETE FROM ingredients;
DELETE FROM categories;
DELETE FROM admin_users;
DELETE FROM delivery_persons;
DELETE FROM branches;

INSERT INTO branches (id, name, address, phone)
VALUES (uuid_generate_v4(), 'Sucursal Principal', 'Av. Principal #123, Centro', '444-000-0001');

INSERT INTO categories (id, name, sort_order) VALUES
  (uuid_generate_v4(), 'Pizzas', 1),
  (uuid_generate_v4(), 'Bebidas', 2),
  (uuid_generate_v4(), 'Extras', 3);

INSERT INTO products (id, category_id, name, description, sort_order)
SELECT uuid_generate_v4(), id, 'Pizza Margarita', 'Salsa de tomate, mozzarella y albahaca', 1
FROM categories WHERE name = 'Pizzas';

INSERT INTO products (id, category_id, name, description, sort_order)
SELECT uuid_generate_v4(), id, 'Pizza Hawaiana', 'Jamon, piña y mozzarella', 2
FROM categories WHERE name = 'Pizzas';

INSERT INTO products (id, category_id, name, description, sort_order)
SELECT uuid_generate_v4(), id, 'Pizza Pepperoni', 'Pepperoni y mozzarella', 3
FROM categories WHERE name = 'Pizzas';

INSERT INTO product_variants (id, product_id, name, size_cm, price, sort_order)
SELECT uuid_generate_v4(), id, 'Chica', 25, 120.00, 1 FROM products WHERE name = 'Pizza Margarita'
UNION ALL
SELECT uuid_generate_v4(), id, 'Mediana', 30, 165.00, 2 FROM products WHERE name = 'Pizza Margarita'
UNION ALL
SELECT uuid_generate_v4(), id, 'Grande', 40, 220.00, 3 FROM products WHERE name = 'Pizza Margarita'
UNION ALL
SELECT uuid_generate_v4(), id, 'Chica', 25, 130.00, 1 FROM products WHERE name = 'Pizza Hawaiana'
UNION ALL
SELECT uuid_generate_v4(), id, 'Mediana', 30, 175.00, 2 FROM products WHERE name = 'Pizza Hawaiana'
UNION ALL
SELECT uuid_generate_v4(), id, 'Grande', 40, 235.00, 3 FROM products WHERE name = 'Pizza Hawaiana'
UNION ALL
SELECT uuid_generate_v4(), id, 'Chica', 25, 135.00, 1 FROM products WHERE name = 'Pizza Pepperoni'
UNION ALL
SELECT uuid_generate_v4(), id, 'Mediana', 30, 180.00, 2 FROM products WHERE name = 'Pizza Pepperoni'
UNION ALL
SELECT uuid_generate_v4(), id, 'Grande', 40, 245.00, 3 FROM products WHERE name = 'Pizza Pepperoni';

INSERT INTO ingredients (name, price) VALUES
  ('Queso extra', 25.00),
  ('Jamon', 20.00),
  ('Pepperoni', 20.00),
  ('Champinones', 15.00),
  ('Chile jalapeno', 10.00),
  ('Aceitunas', 15.00),
  ('Cebolla', 10.00),
  ('Pimiento', 10.00);

INSERT INTO admin_users (branch_id, name, email, password_hash, role)
SELECT id, 'Administrador', 'admin@pizzeria.com',
       '$2b$12$PLACEHOLDER_HASH_CHANGE_ME_BEFORE_PROD', 'superadmin'
FROM branches LIMIT 1;

SELECT 'Categorías creadas:' AS info, count(*) FROM categories;
SELECT 'Productos creados:' AS info, count(*) FROM products;
SELECT 'Variantes creadas:' AS info, count(*) FROM product_variants;
SELECT 'Ingredientes creados:' AS info, count(*) FROM ingredients;