-- AlterTable
ALTER TABLE `attendance_days` ADD COLUMN `expected_minutes` INTEGER NULL,
    ADD COLUMN `flags` JSON NULL,
    ADD COLUMN `overtime_decided_at` DATETIME(3) NULL,
    ADD COLUMN `overtime_decided_by` CHAR(36) NULL,
    ADD COLUMN `overtime_status` ENUM('NONE', 'PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'NONE';

-- AlterTable: add nullable, backfill from the server timestamp, then require it
ALTER TABLE `attendance_punches` ADD COLUMN `work_date` DATE NULL;
UPDATE `attendance_punches` SET `work_date` = DATE(`server_ts`) WHERE `work_date` IS NULL;
ALTER TABLE `attendance_punches` MODIFY `work_date` DATE NOT NULL;

-- AlterTable
ALTER TABLE `overtime_rules` ADD COLUMN `rest_day_all_overtime` BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE `attendance_policies` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `legal_entity_id` CHAR(36) NULL,
    `scope_key` VARCHAR(36) NOT NULL,
    `present_percent` INTEGER NOT NULL DEFAULT 75,
    `half_day_percent` INTEGER NOT NULL DEFAULT 50,
    `auto_deduct_break` BOOLEAN NOT NULL DEFAULT true,
    `capture_ip` BOOLEAN NOT NULL DEFAULT false,
    `capture_geo` BOOLEAN NOT NULL DEFAULT false,
    `regularization_window_days` INTEGER NOT NULL DEFAULT 30,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `attendance_policies_tenant_id_id_key`(`tenant_id`, `id`),
    UNIQUE INDEX `attendance_policies_tenant_id_scope_key_key`(`tenant_id`, `scope_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `attendance_punches_tenant_id_employee_id_work_date_idx` ON `attendance_punches`(`tenant_id`, `employee_id`, `work_date`);

-- AddForeignKey
ALTER TABLE `attendance_policies` ADD CONSTRAINT `attendance_policies_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `attendance_policies` ADD CONSTRAINT `attendance_policies_tenant_id_legal_entity_id_fkey` FOREIGN KEY (`tenant_id`, `legal_entity_id`) REFERENCES `legal_entities`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Guards -----------------------------------------------------------------------
-- Thresholds must make sense even if the API is bypassed.
ALTER TABLE `attendance_policies`
  ADD CONSTRAINT `attendance_policies_percent_chk` CHECK (`half_day_percent` BETWEEN 1 AND 100 AND `present_percent` BETWEEN `half_day_percent` AND 100),
  ADD CONSTRAINT `attendance_policies_window_chk` CHECK (`regularization_window_days` BETWEEN 0 AND 366);

-- Punches are evidence: they are never edited. Corrections add new CORRECTION punches instead.
CREATE TRIGGER attendance_punches_no_update BEFORE UPDATE ON attendance_punches FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE: attendance_punches cannot be edited; add a correction';

-- A locked attendance day (inputs locked for payroll) cannot change until it is explicitly unlocked.
CREATE TRIGGER attendance_days_locked BEFORE UPDATE ON attendance_days FOR EACH ROW
BEGIN
  IF OLD.is_locked = 1 AND NEW.is_locked = 1 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE: attendance day is locked';
  END IF;
END;
