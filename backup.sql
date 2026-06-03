-- MySQL dump 10.13  Distrib 8.0.28, for Win64 (x86_64)
--
-- Host: localhost    Database: log
-- ------------------------------------------------------
-- Server version	5.5.5-10.4.32-MariaDB

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `alert_rules`
--

DROP TABLE IF EXISTS `alert_rules`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `alert_rules` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
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
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `fk_alert_rules_user` (`created_by`),
  KEY `idx_alert_rules_active` (`is_active`,`created_by`),
  CONSTRAINT `fk_alert_rules_user` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=16 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `alert_rules`
--

LOCK TABLES `alert_rules` WRITE;
/*!40000 ALTER TABLE `alert_rules` DISABLE KEYS */;
/*!40000 ALTER TABLE `alert_rules` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `alerts`
--

DROP TABLE IF EXISTS `alerts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `alerts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
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
  `context` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'AM├ëLIORATION 2: Enriched context (triggered_at, rule_name, sample_logs, affected_modules)' CHECK (json_valid(`context`)),
  PRIMARY KEY (`id`),
  KEY `idx_alerts_user_id` (`user_id`),
  KEY `idx_alerts_resolved` (`resolved_at`),
  KEY `idx_alerts_rule_created` (`rule_id`,`created_at`),
  CONSTRAINT `fk_alerts_rule` FOREIGN KEY (`rule_id`) REFERENCES `alert_rules` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=37 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `alerts`
--

LOCK TABLES `alerts` WRITE;
/*!40000 ALTER TABLE `alerts` DISABLE KEYS */;
/*!40000 ALTER TABLE `alerts` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `anomalies`
--

DROP TABLE IF EXISTS `anomalies`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `anomalies` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
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
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_user_service_ts` (`user_id`,`service`,`detected_at`),
  KEY `idx_severity_resolved` (`severity`,`resolved_at`),
  CONSTRAINT `anomalies_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `anomalies`
--

LOCK TABLES `anomalies` WRITE;
/*!40000 ALTER TABLE `anomalies` DISABLE KEYS */;
/*!40000 ALTER TABLE `anomalies` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `audit_log`
--

DROP TABLE IF EXISTS `audit_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_log` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) DEFAULT NULL,
  `user_email` varchar(255) DEFAULT NULL,
  `action` varchar(100) DEFAULT NULL,
  `resource_type` varchar(100) DEFAULT NULL,
  `resource_id` varchar(100) DEFAULT NULL,
  `details` text DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_audit_user` (`user_id`),
  KEY `idx_audit_action` (`action`),
  KEY `idx_audit_resource` (`resource_type`),
  KEY `idx_audit_created` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=120 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `audit_log`
--

LOCK TABLES `audit_log` WRITE;
/*!40000 ALTER TABLE `audit_log` DISABLE KEYS */;
/*!40000 ALTER TABLE `audit_log` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `error_groups`
--

DROP TABLE IF EXISTS `error_groups`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `error_groups` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
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
  `user_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_fingerprint_user` (`fingerprint`,`user_id`),
  KEY `idx_error_groups_user_id` (`user_id`),
  KEY `idx_error_groups_fingerprint` (`fingerprint`),
  KEY `idx_error_groups_status_last` (`status`,`last_seen`),
  KEY `idx_error_groups_error_type` (`error_type`)
) ENGINE=InnoDB AUTO_INCREMENT=182985 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `error_groups`
--

LOCK TABLES `error_groups` WRITE;
/*!40000 ALTER TABLE `error_groups` DISABLE KEYS */;
/*!40000 ALTER TABLE `error_groups` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `import_jobs`
--

DROP TABLE IF EXISTS `import_jobs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
  PRIMARY KEY (`id`),
  KEY `fk_import_jobs_user` (`user_id`),
  CONSTRAINT `fk_import_jobs_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `import_jobs`
--

LOCK TABLES `import_jobs` WRITE;
/*!40000 ALTER TABLE `import_jobs` DISABLE KEYS */;
/*!40000 ALTER TABLE `import_jobs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `logs`
--

DROP TABLE IF EXISTS `logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `logs` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
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
  `timestamp_inferred` tinyint(1) DEFAULT 0 COMMENT 'AM├ëLIORATION 1: Flag if timestamp was inferred from import time',
  `classification_confidence` decimal(4,3) DEFAULT 0.500,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_fingerprint_ts_user` (`fingerprint`,`timestamp`,`user_id`),
  KEY `idx_timestamp` (`timestamp`),
  KEY `idx_log_level` (`log_level`),
  KEY `idx_fingerprint` (`fingerprint`),
  KEY `idx_source` (`source`),
  KEY `idx_service` (`service`),
  KEY `idx_event_type` (`event_type`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_user_ts` (`user_id`,`timestamp`),
  KEY `idx_user_level_ts` (`user_id`,`log_level`,`timestamp`),
  KEY `idx_host_ts` (`host`,`timestamp`),
  KEY `idx_module_level_ts` (`module`,`log_level`,`timestamp`),
  KEY `idx_format_ts` (`log_format`,`timestamp`),
  KEY `idx_user_service_level_ts` (`user_id`,`service`,`log_level`,`timestamp`),
  KEY `idx_created_level_user` (`created_at`,`log_level`,`user_id`),
  KEY `idx_format_user_ts` (`log_format`,`user_id`,`timestamp`),
  KEY `idx_request_id` (`request_id`),
  KEY `idx_status_code_ts` (`status_code`,`timestamp`),
  KEY `idx_logs_timestamp` (`timestamp`),
  KEY `idx_logs_level` (`log_level`),
  KEY `idx_logs_source` (`source`),
  KEY `idx_logs_service` (`service`),
  KEY `idx_logs_user_id` (`user_id`),
  KEY `idx_logs_trends` (`timestamp`,`log_level`,`user_id`),
  KEY `idx_logs_search` (`timestamp`,`user_id`,`log_level`,`source`,`service`),
  KEY `idx_logs_message` (`message`(255)),
  KEY `idx_logs_user_timestamp` (`user_id`,`timestamp`),
  KEY `idx_logs_fingerprint` (`fingerprint`),
  KEY `idx_target_user` (`target_user`),
  KEY `idx_error_type` (`error_type`),
  KEY `idx_logs_user_ts_level` (`user_id`,`timestamp`,`log_level`),
  KEY `idx_logs_user_ts_fp` (`user_id`,`timestamp`,`fingerprint`),
  KEY `idx_logs_user_ts` (`user_id`,`timestamp`),
  KEY `idx_logs_source_server` (`source_server`),
  KEY `idx_logs_error_type` (`error_type`),
  KEY `idx_logs_user_error_type_ts` (`user_id`,`error_type`,`timestamp`),
  KEY `idx_logs_user_fingerprint_ts` (`user_id`,`fingerprint`,`timestamp`),
  KEY `idx_logs_imported_at` (`imported_at`),
  FULLTEXT KEY `ft_message` (`message`,`normalized_message`),
  CONSTRAINT `fk_logs_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=182985 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `logs`
--

LOCK TABLES `logs` WRITE;
/*!40000 ALTER TABLE `logs` DISABLE KEYS */;
/*!40000 ALTER TABLE `logs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `parser_metrics`
--

DROP TABLE IF EXISTS `parser_metrics`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `parser_metrics` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `format_type` varchar(50) DEFAULT NULL,
  `total_lines` int(11) DEFAULT 0,
  `success_count` int(11) DEFAULT 0,
  `error_count` int(11) DEFAULT 0,
  `avg_parse_time_ms` decimal(8,2) DEFAULT NULL,
  `processed_at` datetime DEFAULT current_timestamp(),
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_format_ts` (`format_type`,`processed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `parser_metrics`
--

LOCK TABLES `parser_metrics` WRITE;
/*!40000 ALTER TABLE `parser_metrics` DISABLE KEYS */;
/*!40000 ALTER TABLE `parser_metrics` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `sessions`
--

DROP TABLE IF EXISTS `sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sessions` (
  `session_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `expires` int(11) unsigned NOT NULL,
  `data` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  PRIMARY KEY (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `sessions`
--

LOCK TABLES `sessions` WRITE;
/*!40000 ALTER TABLE `sessions` DISABLE KEYS */;
/*!40000 ALTER TABLE `sessions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `email` varchar(255) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `display_name` varchar(100) DEFAULT NULL,
  `role` enum('user','admin') DEFAULT 'user',
  `is_active` tinyint(1) DEFAULT 1,
  `last_login` datetime DEFAULT NULL,
  `session_version` int(11) DEFAULT 0,
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `watch_log_metrics`
--

DROP TABLE IF EXISTS `watch_log_metrics`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `watch_log_metrics` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `watch_directory` varchar(1024) DEFAULT NULL,
  `total_files` int(11) DEFAULT 0,
  `total_lines_processed` bigint(20) DEFAULT 0,
  `last_scan_at` datetime DEFAULT NULL,
  `errors_detected` int(11) DEFAULT 0,
  `last_error` text DEFAULT NULL,
  `status` enum('active','paused','error') DEFAULT 'active',
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_user_status` (`user_id`,`status`),
  KEY `idx_updated_ts` (`updated_at`),
  CONSTRAINT `watch_log_metrics_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `watch_log_metrics`
--

LOCK TABLES `watch_log_metrics` WRITE;
/*!40000 ALTER TABLE `watch_log_metrics` DISABLE KEYS */;
/*!40000 ALTER TABLE `watch_log_metrics` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `watch_offsets`
--

DROP TABLE IF EXISTS `watch_offsets`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `watch_offsets` (
  `path` varchar(512) NOT NULL,
  `offset` bigint(20) DEFAULT 0,
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`path`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `watch_offsets`
--

LOCK TABLES `watch_offsets` WRITE;
/*!40000 ALTER TABLE `watch_offsets` DISABLE KEYS */;
INSERT INTO `watch_offsets` VALUES ('logs\\server-codex.err.log',75746,'2026-05-26 15:53:04'),('logs\\server-codex.out.log',35139,'2026-05-26 15:53:04');
/*!40000 ALTER TABLE `watch_offsets` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-06-03 12:11:49
