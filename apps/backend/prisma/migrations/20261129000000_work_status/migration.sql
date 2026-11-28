-- AlterTable: punches written by the system (an abandoned work session closed at its last heartbeat).
ALTER TABLE `attendance_punches` MODIFY `source` ENUM('WEB', 'MOBILE', 'DESKTOP_AGENT', 'BIOMETRIC', 'IMPORT', 'CORRECTION', 'SYSTEM') NOT NULL;

-- AlterTable: who decided a work-from-home request, and why.
ALTER TABLE `wfh_requests`
  ADD COLUMN `decided_by` CHAR(36) NULL,
  ADD COLUMN `decided_at` DATETIME(3) NULL,
  ADD COLUMN `decision_note` VARCHAR(1000) NULL;

-- Guards -----------------------------------------------------------------------
ALTER TABLE `work_policies`
  ADD CONSTRAINT `work_policies_window_chk` CHECK (`allowed_start_min` >= 0 AND `allowed_end_min` <= 1440 AND `allowed_end_min` > `allowed_start_min`),
  ADD CONSTRAINT `work_policies_timeouts_chk` CHECK (`heartbeat_timeout_sec` BETWEEN 60 AND 3600 AND `idle_threshold_sec` > 0 AND `resume_window_min` > 0),
  ADD CONSTRAINT `work_policies_dates_chk` CHECK (`effective_to` IS NULL OR `effective_to` >= `effective_from`),
  ADD CONSTRAINT `work_policies_target_chk` CHECK ((`applies_to` = 'COMPANY') = (`target_id` IS NULL));
ALTER TABLE `wfh_requests` ADD CONSTRAINT `wfh_requests_dates_chk` CHECK (`to_date` >= `from_date`);
ALTER TABLE `work_sessions`
  ADD CONSTRAINT `work_sessions_end_chk` CHECK (`ended_at` IS NULL OR `ended_at` >= `started_at`),
  ADD CONSTRAINT `work_sessions_totals_chk` CHECK (`worked_sec` >= 0 AND `break_sec` >= 0 AND `idle_sec` >= 0 AND `disconnected_sec` >= 0);
ALTER TABLE `work_corrections` ADD CONSTRAINT `work_corrections_range_chk` CHECK (`to_ts` > `from_ts`);
ALTER TABLE `work_breaks` ADD CONSTRAINT `work_breaks_end_chk` CHECK (`ended_at` IS NULL OR `ended_at` >= `started_at`);
