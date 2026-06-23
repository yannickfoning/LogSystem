-- FIX #12: Add composite indexes for user_id with timestamp, imported_at, log_level
-- These indexes improve query performance for multi-tenant scoped queries

-- Index for user_id with imported_at (import filters).
-- MySQL 5.7/Aiven do not support CREATE INDEX IF NOT EXISTS; duplicate indexes
-- are ignored by the migration runner.
CREATE INDEX idx_user_imported ON logs(user_id, imported_at DESC);

-- Note: idx_user_ts, idx_user_level_ts, idx_user_error_type_ts, and idx_user_fingerprint_ts
-- already exist in schema.sql, so we don't need to recreate them here.
