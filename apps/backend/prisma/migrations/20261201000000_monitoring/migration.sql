-- Guards for monitoring (Sprint 10) -------------------------------------------------
-- Screenshot policies: a floor on the interval, bounded jitter and retention, and application activity can never
-- be switched on until that feature exists with its own review.
ALTER TABLE `screenshot_policies`
  ADD CONSTRAINT `screenshot_policies_interval_chk` CHECK (`interval_min` BETWEEN 5 AND 240),
  ADD CONSTRAINT `screenshot_policies_jitter_chk` CHECK (`jitter_pct` BETWEEN 0 AND 50),
  ADD CONSTRAINT `screenshot_policies_retention_chk` CHECK (`retention_days` BETWEEN 1 AND 90),
  ADD CONSTRAINT `screenshot_policies_no_activity_chk` CHECK (`activity_tracking_enabled` = false),
  ADD CONSTRAINT `screenshot_policies_target_chk` CHECK ((`applies_to` = 'COMPANY') = (`target_id` IS NULL)),
  ADD CONSTRAINT `screenshot_policies_dates_chk` CHECK (`effective_to` IS NULL OR `effective_to` >= `effective_from`);
ALTER TABLE `monitoring_activations`
  ADD CONSTRAINT `monitoring_activations_retention_chk` CHECK (`retention_days` BETWEEN 7 AND 90),
  ADD CONSTRAINT `monitoring_activations_completed_chk` CHECK (`status` = 'DRAFT' OR `completed_at` IS NOT NULL);
ALTER TABLE `screenshot_records`
  ADD CONSTRAINT `screenshot_records_bytes_chk` CHECK (`bytes` IS NULL OR `bytes` BETWEEN 1 AND 2000000),
  ADD CONSTRAINT `screenshot_records_deleted_chk` CHECK ((`status` = 'DELETED') = (`deleted_at` IS NOT NULL));
ALTER TABLE `device_pairing_codes` ADD CONSTRAINT `device_pairing_codes_attempts_chk` CHECK (`attempts` BETWEEN 0 AND 10);
