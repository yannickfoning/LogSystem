-- Ensure analyst role exists in users ENUM (idempotent via migration runner)
-- This migration is safe to run multiple times; ER_DUP_FIELDNAME is ignored.
ALTER TABLE users
  MODIFY COLUMN role ENUM('user','analyst','admin') DEFAULT 'user';
