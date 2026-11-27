-- CreateTable
CREATE TABLE `payroll_settings` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `legal_entity_id` CHAR(36) NOT NULL,
    `paid_days_basis` ENUM('CALENDAR', 'FIXED_30') NOT NULL DEFAULT 'CALENDAR',
    `lop_from_absence` BOOLEAN NOT NULL DEFAULT false,
    `pay_day_of_month` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payroll_settings_tenant_id_id_key`(`tenant_id`, `id`),
    UNIQUE INDEX `payroll_settings_tenant_id_legal_entity_id_key`(`tenant_id`, `legal_entity_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `payroll_settings` ADD CONSTRAINT `payroll_settings_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `payroll_settings` ADD CONSTRAINT `payroll_settings_tenant_id_legal_entity_id_fkey` FOREIGN KEY (`tenant_id`, `legal_entity_id`) REFERENCES `legal_entities`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Guards -----------------------------------------------------------------------
ALTER TABLE `payroll_settings`
  ADD CONSTRAINT `payroll_settings_pay_day_chk` CHECK (`pay_day_of_month` IS NULL OR `pay_day_of_month` BETWEEN 1 AND 31);
-- Salaries and payroll money are never negative where that makes no sense.
ALTER TABLE `employee_salaries` ADD CONSTRAINT `employee_salaries_ctc_chk` CHECK (`annual_ctc` >= 0);
ALTER TABLE `payroll_periods` ADD CONSTRAINT `payroll_periods_dates_chk` CHECK (`end_date` >= `start_date`);
