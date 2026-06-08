-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Hôte : 127.0.0.1
-- Généré le : mar. 09 juin 2026 à 00:35
-- Version du serveur : 10.4.32-MariaDB
-- Version de PHP : 8.0.30

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Base de données : `log`
--

-- --------------------------------------------------------

--
-- Structure de la table `alerts`
--

CREATE TABLE `alerts` (
  `id` int(11) NOT NULL,
  `rule_id` int(11) DEFAULT NULL,
  `alert_type` varchar(100) DEFAULT NULL,
  `severity` varchar(20) DEFAULT NULL,
  `message` text DEFAULT NULL,
  `status` enum('new','read','dismissed') DEFAULT 'new',
  `metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`metadata`)),
  `created_at` datetime DEFAULT current_timestamp(),
  `read_at` datetime DEFAULT NULL,
  `resolved_at` datetime DEFAULT NULL,
  `user_id` int(11) DEFAULT NULL,
  `context` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'AMÉLIORATION 2: Enriched context (triggered_at, rule_name, sample_logs, affected_modules)' CHECK (json_valid(`context`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Structure de la table `alert_rules`
--

CREATE TABLE `alert_rules` (
  `id` int(11) NOT NULL,
  `name` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `condition_type` enum('level','count','fingerprint','threshold','silence') NOT NULL,
  `condition_value` text NOT NULL,
  `threshold_value` int(11) DEFAULT NULL,
  `time_window_minutes` int(11) DEFAULT 60,
  `severity` enum('low','medium','high','critical') DEFAULT 'medium',
  `cooldown_minutes` int(11) DEFAULT 30,
  `is_active` tinyint(1) DEFAULT 1,
  `created_by` int(11) DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Déchargement des données de la table `alert_rules`
--

INSERT INTO `alert_rules` (`id`, `name`, `description`, `condition_type`, `condition_value`, `threshold_value`, `time_window_minutes`, `severity`, `cooldown_minutes`, `is_active`, `created_by`, `created_at`) VALUES
(101, 'ERROR_LIMIT', '10 erreurs / 5 minutes', 'threshold', 'ERROR', 10, 5, 'high', 10, 1, 9, '2026-06-08 23:09:49'),
(102, 'FATAL_TRIGGER', '1 occurrence FATAL', 'threshold', 'FATAL', 1, 1, 'critical', 5, 1, 9, '2026-06-08 23:09:49'),
(103, 'SECURITY_BREACH', '3 events securite', 'threshold', 'SECURITY', 3, 15, 'critical', 10, 1, 9, '2026-06-08 23:09:49'),
(104, 'AUTH_BRUTEFORCE', '5 echecs auth', 'threshold', 'AUTH', 5, 10, 'high', 15, 1, 9, '2026-06-08 23:09:49'),
(105, 'DISK_THRESHOLD', 'Disque > 80%', 'threshold', 'DISK', 80, 5, 'medium', 60, 1, 9, '2026-06-08 23:09:49');

-- --------------------------------------------------------

--
-- Structure de la table `anomalies`
--

CREATE TABLE `anomalies` (
  `id` bigint(20) NOT NULL,
  `user_id` int(11) NOT NULL,
  `service` varchar(255) DEFAULT NULL,
  `module` varchar(255) DEFAULT NULL,
  `anomaly_type` enum('spike','drop','pattern','outlier') DEFAULT 'spike',
  `baseline` decimal(10,2) DEFAULT NULL,
  `actual` decimal(10,2) DEFAULT NULL,
  `severity` enum('low','medium','high','critical') DEFAULT 'medium',
  `description` text DEFAULT NULL,
  `detected_at` datetime DEFAULT current_timestamp(),
  `resolved_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Structure de la table `audit_log`
--

CREATE TABLE `audit_log` (
  `id` int(11) NOT NULL,
  `user_id` int(11) DEFAULT NULL,
  `user_email` varchar(255) DEFAULT NULL,
  `action` varchar(100) DEFAULT NULL,
  `resource_type` varchar(100) DEFAULT NULL,
  `resource_id` varchar(100) DEFAULT NULL,
  `details` text DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Structure de la table `error_groups`
--

CREATE TABLE `error_groups` (
  `id` int(11) NOT NULL,
  `fingerprint` varchar(40) NOT NULL,
  `title` varchar(500) DEFAULT NULL,
  `event_type` varchar(100) DEFAULT NULL,
  `severity_max` varchar(10) DEFAULT NULL,
  `occurrence_count` int(11) DEFAULT 1,
  `first_seen` datetime DEFAULT NULL,
  `last_seen` datetime DEFAULT NULL,
  `previous_seen` datetime DEFAULT NULL,
  `resolved_at` datetime DEFAULT NULL,
  `returned_at` datetime DEFAULT NULL,
  `return_count` int(11) DEFAULT 0,
  `return_reason` text DEFAULT NULL,
  `source_server` varchar(255) DEFAULT NULL,
  `service` varchar(255) DEFAULT NULL,
  `error_type` varchar(100) DEFAULT NULL,
  `status` enum('open','resolved','returned') DEFAULT 'open',
  `sample_log_id` bigint(20) DEFAULT NULL,
  `user_id` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Structure de la table `import_jobs`
--

CREATE TABLE `import_jobs` (
  `id` varchar(36) NOT NULL,
  `filename` varchar(255) DEFAULT NULL,
  `status` enum('pending','processing','completed','failed') DEFAULT 'pending',
  `total_lines` int(11) DEFAULT 0,
  `processed_lines` int(11) DEFAULT 0,
  `error_count` int(11) DEFAULT 0,
  `error_message` text DEFAULT NULL,
  `skipped_lines` int(11) DEFAULT 0,
  `import_source` varchar(255) DEFAULT NULL,
  `import_service` varchar(255) DEFAULT NULL,
  `user_id` int(11) DEFAULT NULL,
  `started_at` datetime DEFAULT NULL,
  `completed_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `file_size` bigint(20) DEFAULT NULL,
  `file_hash` varchar(64) DEFAULT NULL,
  `source_directory` varchar(1024) DEFAULT NULL,
  `import_ip_address` varchar(45) DEFAULT NULL,
  `import_summary` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`import_summary`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Structure de la table `logs`
--

CREATE TABLE `logs` (
  `id` bigint(20) NOT NULL,
  `raw_log` text DEFAULT NULL,
  `timestamp` datetime NOT NULL,
  `created_time` time DEFAULT NULL,
  `imported_at` datetime DEFAULT current_timestamp(),
  `timezone` varchar(64) DEFAULT NULL,
  `log_level` enum('DEBUG','INFO','WARNING','ERROR','CRITICAL','FATAL') DEFAULT 'INFO',
  `source` varchar(255) DEFAULT NULL,
  `source_server` varchar(255) DEFAULT NULL,
  `service` varchar(255) DEFAULT NULL,
  `message` text DEFAULT NULL,
  `normalized_message` text DEFAULT NULL,
  `event_type` varchar(100) DEFAULT 'generic',
  `fingerprint` varchar(40) DEFAULT NULL,
  `user_id` int(11) DEFAULT NULL,
  `client_ip` varchar(45) DEFAULT NULL,
  `module` varchar(100) DEFAULT NULL,
  `error_type` varchar(100) DEFAULT NULL,
  `stack_trace` mediumtext DEFAULT NULL,
  `target_user` varchar(255) DEFAULT NULL,
  `parser_format` varchar(50) DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `ip_address` varchar(45) DEFAULT NULL COMMENT 'Client or source IP',
  `host` varchar(255) DEFAULT NULL COMMENT 'Hostname or server name',
  `log_format` varchar(50) DEFAULT 'unknown' COMMENT 'Parser detected format: plain, json, csv, xml, syslog, docker, kubernetes, etc',
  `request_id` varchar(100) DEFAULT NULL COMMENT 'Correlation ID for request tracing',
  `duration_ms` int(11) DEFAULT NULL COMMENT 'Operation duration in milliseconds',
  `status_code` int(11) DEFAULT NULL COMMENT 'HTTP or operation status code',
  `timestamp_inferred` tinyint(1) DEFAULT 0 COMMENT 'AMÉLIORATION 1: Flag if timestamp was inferred from import time',
  `classification_confidence` decimal(4,3) DEFAULT 0.500,
  `created_time_log` time DEFAULT NULL,
  `imported_time` time DEFAULT NULL,
  `file_created_at` datetime DEFAULT NULL,
  `file_modified_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Structure de la table `parser_metrics`
--

CREATE TABLE `parser_metrics` (
  `id` bigint(20) NOT NULL,
  `format_type` varchar(50) DEFAULT NULL,
  `total_lines` int(11) DEFAULT 0,
  `success_count` int(11) DEFAULT 0,
  `error_count` int(11) DEFAULT 0,
  `avg_parse_time_ms` decimal(8,2) DEFAULT NULL,
  `processed_at` datetime DEFAULT current_timestamp(),
  `created_at` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Structure de la table `sessions`
--

CREATE TABLE `sessions` (
  `session_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `expires` int(11) UNSIGNED NOT NULL,
  `data` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Structure de la table `users`
--

CREATE TABLE `users` (
  `id` int(11) NOT NULL,
  `email` varchar(255) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `display_name` varchar(100) DEFAULT NULL,
  `role` enum('user','analyst','admin') DEFAULT 'user',
  `is_active` tinyint(1) DEFAULT 1,
  `last_login` datetime DEFAULT NULL,
  `session_version` int(11) DEFAULT 0,
  `created_at` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Déchargement des données de la table `users`
--

INSERT INTO `users` (`id`, `email`, `password_hash`, `display_name`, `role`, `is_active`, `last_login`, `session_version`, `created_at`) VALUES
(9, 'admin@logsystem.local', '$2b$12$odqFAIyGXmuZaA9Op9YjxeMxL2pkl4xRemSPZ6e/eJc8c5EKAET8W', 'Administrateur', 'admin', 1, NULL, 0, '2026-06-08 23:05:31'),
(10, 'analyste@logsystem.local', '$2b$12$O5NpeCZo3II2g35hoHV0FeCkinKB7y4LtfXKIkIllvMJ2/UqlgEDG', 'Analyste', 'analyst', 1, NULL, 0, '2026-06-08 23:05:31');

-- --------------------------------------------------------

--
-- Structure de la table `watch_log_metrics`
--

CREATE TABLE `watch_log_metrics` (
  `id` bigint(20) NOT NULL,
  `user_id` int(11) NOT NULL,
  `watch_directory` varchar(1024) DEFAULT NULL,
  `total_files` int(11) DEFAULT 0,
  `total_lines_processed` bigint(20) DEFAULT 0,
  `last_scan_at` datetime DEFAULT NULL,
  `errors_detected` int(11) DEFAULT 0,
  `last_error` text DEFAULT NULL,
  `status` enum('active','paused','error') DEFAULT 'active',
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Structure de la table `watch_offsets`
--

CREATE TABLE `watch_offsets` (
  `path` varchar(512) NOT NULL,
  `offset` bigint(20) DEFAULT 0,
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Déchargement des données de la table `watch_offsets`
--

INSERT INTO `watch_offsets` (`path`, `offset`, `updated_at`) VALUES
('logs\\server-codex.err.log', 75746, '2026-05-26 15:53:04'),
('logs\\server-codex.out.log', 35139, '2026-05-26 15:53:04');

--
-- Index pour les tables déchargées
--

--
-- Index pour la table `alerts`
--
ALTER TABLE `alerts`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_alerts_user_id` (`user_id`),
  ADD KEY `idx_alerts_resolved` (`resolved_at`),
  ADD KEY `idx_alerts_rule_created` (`rule_id`,`created_at`);

--
-- Index pour la table `alert_rules`
--
ALTER TABLE `alert_rules`
  ADD PRIMARY KEY (`id`),
  ADD KEY `fk_alert_rules_user` (`created_by`),
  ADD KEY `idx_alert_rules_active` (`is_active`,`created_by`);

--
-- Index pour la table `anomalies`
--
ALTER TABLE `anomalies`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_user_service_ts` (`user_id`,`service`,`detected_at`),
  ADD KEY `idx_severity_resolved` (`severity`,`resolved_at`);

--
-- Index pour la table `audit_log`
--
ALTER TABLE `audit_log`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_audit_user` (`user_id`),
  ADD KEY `idx_audit_action` (`action`),
  ADD KEY `idx_audit_resource` (`resource_type`),
  ADD KEY `idx_audit_created` (`created_at`),
  ADD KEY `idx_audit_timestamp2` (`created_at`);

--
-- Index pour la table `error_groups`
--
ALTER TABLE `error_groups`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `idx_fingerprint_user` (`fingerprint`,`user_id`),
  ADD KEY `idx_error_groups_user_id` (`user_id`),
  ADD KEY `idx_error_groups_fingerprint` (`fingerprint`),
  ADD KEY `idx_error_groups_status_last` (`status`,`last_seen`),
  ADD KEY `idx_error_groups_error_type` (`error_type`);

--
-- Index pour la table `import_jobs`
--
ALTER TABLE `import_jobs`
  ADD PRIMARY KEY (`id`),
  ADD KEY `fk_import_jobs_user` (`user_id`);

--
-- Index pour la table `logs`
--
ALTER TABLE `logs`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `idx_fingerprint_ts_user` (`fingerprint`,`timestamp`,`user_id`),
  ADD KEY `idx_timestamp` (`timestamp`),
  ADD KEY `idx_log_level` (`log_level`),
  ADD KEY `idx_fingerprint` (`fingerprint`),
  ADD KEY `idx_source` (`source`),
  ADD KEY `idx_service` (`service`),
  ADD KEY `idx_event_type` (`event_type`),
  ADD KEY `idx_user_id` (`user_id`),
  ADD KEY `idx_user_ts` (`user_id`,`timestamp`),
  ADD KEY `idx_user_level_ts` (`user_id`,`log_level`,`timestamp`),
  ADD KEY `idx_host_ts` (`host`,`timestamp`),
  ADD KEY `idx_module_level_ts` (`module`,`log_level`,`timestamp`),
  ADD KEY `idx_format_ts` (`log_format`,`timestamp`),
  ADD KEY `idx_user_service_level_ts` (`user_id`,`service`,`log_level`,`timestamp`),
  ADD KEY `idx_created_level_user` (`created_at`,`log_level`,`user_id`),
  ADD KEY `idx_format_user_ts` (`log_format`,`user_id`,`timestamp`),
  ADD KEY `idx_request_id` (`request_id`),
  ADD KEY `idx_status_code_ts` (`status_code`,`timestamp`),
  ADD KEY `idx_logs_timestamp` (`timestamp`),
  ADD KEY `idx_logs_level` (`log_level`),
  ADD KEY `idx_logs_source` (`source`),
  ADD KEY `idx_logs_service` (`service`),
  ADD KEY `idx_logs_user_id` (`user_id`),
  ADD KEY `idx_logs_trends` (`timestamp`,`log_level`,`user_id`),
  ADD KEY `idx_logs_search` (`timestamp`,`user_id`,`log_level`,`source`,`service`),
  ADD KEY `idx_logs_message` (`message`(255)),
  ADD KEY `idx_logs_user_timestamp` (`user_id`,`timestamp`),
  ADD KEY `idx_logs_fingerprint` (`fingerprint`),
  ADD KEY `idx_target_user` (`target_user`),
  ADD KEY `idx_error_type` (`error_type`),
  ADD KEY `idx_logs_user_ts_level` (`user_id`,`timestamp`,`log_level`),
  ADD KEY `idx_logs_user_ts_fp` (`user_id`,`timestamp`,`fingerprint`),
  ADD KEY `idx_logs_user_ts` (`user_id`,`timestamp`),
  ADD KEY `idx_logs_source_server` (`source_server`),
  ADD KEY `idx_logs_error_type` (`error_type`),
  ADD KEY `idx_logs_user_error_type_ts` (`user_id`,`error_type`,`timestamp`),
  ADD KEY `idx_logs_user_fingerprint_ts` (`user_id`,`fingerprint`,`timestamp`),
  ADD KEY `idx_logs_imported_at` (`imported_at`),
  ADD KEY `idx_imported_at` (`imported_at`),
  ADD KEY `idx_audit_severity` (`log_level`),
  ADD KEY `idx_audit_timestamp` (`timestamp`),
  ADD KEY `idx_audit_source` (`source`),
  ADD KEY `idx_audit_user_id` (`user_id`),
  ADD KEY `idx_logs_combined_search` (`user_id`,`log_level`,`source`,`timestamp`),
  ADD KEY `idx_file_created` (`file_created_at`),
  ADD KEY `idx_logs_file_modified_at` (`file_modified_at`);
ALTER TABLE `logs` ADD FULLTEXT KEY `ft_message` (`message`,`normalized_message`);

--
-- Index pour la table `parser_metrics`
--
ALTER TABLE `parser_metrics`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_format_ts` (`format_type`,`processed_at`);

--
-- Index pour la table `sessions`
--
ALTER TABLE `sessions`
  ADD PRIMARY KEY (`session_id`);

--
-- Index pour la table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `email` (`email`);

--
-- Index pour la table `watch_log_metrics`
--
ALTER TABLE `watch_log_metrics`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_user_status` (`user_id`,`status`),
  ADD KEY `idx_updated_ts` (`updated_at`);

--
-- Index pour la table `watch_offsets`
--
ALTER TABLE `watch_offsets`
  ADD PRIMARY KEY (`path`);

--
-- AUTO_INCREMENT pour les tables déchargées
--

--
-- AUTO_INCREMENT pour la table `alerts`
--
ALTER TABLE `alerts`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=37;

--
-- AUTO_INCREMENT pour la table `alert_rules`
--
ALTER TABLE `alert_rules`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=106;

--
-- AUTO_INCREMENT pour la table `anomalies`
--
ALTER TABLE `anomalies`
  MODIFY `id` bigint(20) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT pour la table `audit_log`
--
ALTER TABLE `audit_log`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=120;

--
-- AUTO_INCREMENT pour la table `error_groups`
--
ALTER TABLE `error_groups`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=182985;

--
-- AUTO_INCREMENT pour la table `logs`
--
ALTER TABLE `logs`
  MODIFY `id` bigint(20) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=182985;

--
-- AUTO_INCREMENT pour la table `parser_metrics`
--
ALTER TABLE `parser_metrics`
  MODIFY `id` bigint(20) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT pour la table `users`
--
ALTER TABLE `users`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=11;

--
-- AUTO_INCREMENT pour la table `watch_log_metrics`
--
ALTER TABLE `watch_log_metrics`
  MODIFY `id` bigint(20) NOT NULL AUTO_INCREMENT;

--
-- Contraintes pour les tables déchargées
--

--
-- Contraintes pour la table `alerts`
--
ALTER TABLE `alerts`
  ADD CONSTRAINT `fk_alerts_rule` FOREIGN KEY (`rule_id`) REFERENCES `alert_rules` (`id`) ON DELETE SET NULL;

--
-- Contraintes pour la table `alert_rules`
--
ALTER TABLE `alert_rules`
  ADD CONSTRAINT `fk_alert_rules_user` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL;

--
-- Contraintes pour la table `anomalies`
--
ALTER TABLE `anomalies`
  ADD CONSTRAINT `anomalies_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Contraintes pour la table `import_jobs`
--
ALTER TABLE `import_jobs`
  ADD CONSTRAINT `fk_import_jobs_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL;

--
-- Contraintes pour la table `logs`
--
ALTER TABLE `logs`
  ADD CONSTRAINT `fk_logs_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Contraintes pour la table `watch_log_metrics`
--
ALTER TABLE `watch_log_metrics`
  ADD CONSTRAINT `watch_log_metrics_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
