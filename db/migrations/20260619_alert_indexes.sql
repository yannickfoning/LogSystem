CREATE INDEX idx_logs_user_ts_level ON logs (user_id, timestamp, log_level);
CREATE INDEX idx_logs_user_ts_fp ON logs (user_id, timestamp, fingerprint);
CREATE INDEX idx_logs_user_ts ON logs (user_id, timestamp);
CREATE INDEX idx_alerts_rule_created ON alerts (rule_id, created_at);
CREATE INDEX idx_alert_rules_active ON alert_rules (is_active, created_by);
CREATE INDEX idx_error_groups_fp ON error_groups (fingerprint);
CREATE INDEX idx_logs_level_ts ON logs (log_level, timestamp);
CREATE INDEX idx_logs_service_ts ON logs (service, timestamp);
