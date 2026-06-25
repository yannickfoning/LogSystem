-- Indexes pour optimiser les performances de LogSystem V4

-- Index sur les logs pour les requêtes principales
CREATE INDEX idx_logs_timestamp ON logs(timestamp);
CREATE INDEX idx_logs_level ON logs(log_level);
CREATE INDEX idx_logs_source ON logs(source);
CREATE INDEX idx_logs_service ON logs(service);
CREATE INDEX idx_logs_user_id ON logs(user_id);

-- Index composites pour les requêtes de dashboard
CREATE INDEX idx_logs_trends ON logs(timestamp, log_level, user_id);
CREATE INDEX idx_logs_search ON logs(timestamp, user_id, log_level, source, service);
CREATE INDEX idx_logs_message ON logs(message(255));

-- Index sur les error_groups pour les doublons
CREATE INDEX idx_error_groups_fingerprint ON error_groups(fingerprint);
CREATE INDEX idx_error_groups_created_at ON error_groups(created_at);
CREATE INDEX idx_error_groups_user_id ON error_groups(user_id);

-- Index sur les alerts
CREATE INDEX idx_alerts_created_at ON alerts(created_at);
CREATE INDEX idx_alerts_user_id ON alerts(user_id);
CREATE INDEX idx_alerts_status ON alerts(status);

-- Index sur les import_jobs
CREATE INDEX idx_import_jobs_status ON import_jobs(status);
CREATE INDEX idx_import_jobs_user_id ON import_jobs(user_id);
CREATE INDEX idx_import_jobs_created_at ON import_jobs(created_at);

-- Index sur audit_log pour la traçabilité
CREATE INDEX idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX idx_audit_log_action ON audit_log(action);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at);

-- Index sur les users
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_is_active ON users(is_active);
