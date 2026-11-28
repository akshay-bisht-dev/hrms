-- CreateIndex: finding a person's running task timer.
CREATE INDEX `task_time_entries_tenant_id_employee_id_ended_at_idx` ON `task_time_entries`(`tenant_id`, `employee_id`, `ended_at`);

-- Guards -----------------------------------------------------------------------
ALTER TABLE `projects` ADD CONSTRAINT `projects_dates_chk` CHECK (`end_date` IS NULL OR `start_date` IS NULL OR `end_date` >= `start_date`);
ALTER TABLE `tasks`
  ADD CONSTRAINT `tasks_progress_chk` CHECK (`progress_pct` BETWEEN 0 AND 100),
  ADD CONSTRAINT `tasks_minutes_chk` CHECK (`actual_min` >= 0 AND (`estimate_min` IS NULL OR `estimate_min` > 0));
ALTER TABLE `task_time_entries`
  ADD CONSTRAINT `task_time_entries_end_chk` CHECK (`ended_at` IS NULL OR `ended_at` >= `started_at`),
  ADD CONSTRAINT `task_time_entries_duration_chk` CHECK (`duration_sec` IS NULL OR `duration_sec` >= 0);
ALTER TABLE `timesheet_approvals` ADD CONSTRAINT `timesheet_approvals_total_chk` CHECK (`total_sec` >= 0);
