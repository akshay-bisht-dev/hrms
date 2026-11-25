-- CreateTable
CREATE TABLE `users` (
    `id` CHAR(36) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `password_hash` VARCHAR(255) NULL,
    `email_verified_at` DATETIME(3) NULL,
    `display_name` VARCHAR(120) NOT NULL,
    `locale` VARCHAR(16) NOT NULL DEFAULT 'en',
    `timezone` VARCHAR(64) NOT NULL DEFAULT 'UTC',
    `status` ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
    `failed_login_count` INTEGER NOT NULL DEFAULT 0,
    `locked_until` DATETIME(3) NULL,
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `platform_admins` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `role` ENUM('OWNER', 'SUPPORT', 'BILLING', 'SECURITY') NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `platform_admins_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refresh_tokens` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NULL,
    `token_hash` CHAR(64) NOT NULL,
    `family_id` CHAR(36) NOT NULL,
    `user_agent` VARCHAR(255) NULL,
    `ip_address` VARCHAR(45) NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `idle_expires_at` DATETIME(3) NOT NULL,
    `rotated_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `revoke_reason` VARCHAR(40) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `refresh_tokens_token_hash_key`(`token_hash`),
    INDEX `refresh_tokens_user_id_idx`(`user_id`),
    INDEX `refresh_tokens_family_id_idx`(`family_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mfa_factors` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `type` ENUM('TOTP', 'WEBAUTHN') NOT NULL,
    `secret_enc` VARBINARY(512) NOT NULL,
    `label` VARCHAR(80) NULL,
    `confirmed_at` DATETIME(3) NULL,
    `last_used_step` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `mfa_factors_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recovery_codes` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `code_hash` CHAR(64) NOT NULL,
    `used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `recovery_codes_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_tokens` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `purpose` ENUM('EMAIL_VERIFY', 'PASSWORD_RESET', 'INVITE') NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `auth_tokens_token_hash_key`(`token_hash`),
    INDEX `auth_tokens_user_id_purpose_idx`(`user_id`, `purpose`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permissions` (
    `code` VARCHAR(80) NOT NULL,
    `module` VARCHAR(40) NOT NULL,
    `description` VARCHAR(255) NOT NULL,
    `is_sensitive` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plans` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `is_public` BOOLEAN NOT NULL DEFAULT true,
    `max_employees` INTEGER NULL,
    `screenshot_retention_max_days` INTEGER NOT NULL DEFAULT 90,
    `features` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `plans_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plan_prices` (
    `id` CHAR(36) NOT NULL,
    `plan_id` CHAR(36) NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `interval` ENUM('MONTH', 'YEAR') NOT NULL,
    `unit_amount` DECIMAL(19, 4) NOT NULL,
    `provider_price_id` VARCHAR(120) NULL,

    UNIQUE INDEX `plan_prices_plan_id_currency_interval_key`(`plan_id`, `currency`, `interval`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `country_profiles` (
    `code` CHAR(2) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `default_currency` CHAR(3) NOT NULL,
    `default_locale` VARCHAR(16) NOT NULL,
    `weekend_days` JSON NOT NULL,
    `field_rules` JSON NOT NULL,
    `national_id_types` JSON NOT NULL,
    `bank_field_format` JSON NOT NULL,
    `address_format` JSON NOT NULL,
    `payroll_coverage` ENUM('NATIVE', 'CONFIGURABLE', 'EXPORT') NOT NULL DEFAULT 'CONFIGURABLE',
    `version` INTEGER NOT NULL DEFAULT 1,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `currencies` (
    `code` CHAR(3) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `minor_units` INTEGER NOT NULL,

    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fx_rates` (
    `id` CHAR(36) NOT NULL,
    `base` CHAR(3) NOT NULL,
    `quote` CHAR(3) NOT NULL,
    `rate` DECIMAL(19, 10) NOT NULL,
    `rate_date` DATE NOT NULL,
    `source` VARCHAR(40) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `fx_rates_base_quote_rate_date_source_key`(`base`, `quote`, `rate_date`, `source`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `statutory_rule_packs` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(60) NOT NULL,
    `country_code` CHAR(2) NOT NULL,
    `region_code` VARCHAR(10) NOT NULL DEFAULT '',
    `name` VARCHAR(120) NOT NULL,
    `engine_module` VARCHAR(60) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `statutory_rule_packs_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `statutory_rule_versions` (
    `id` CHAR(36) NOT NULL,
    `pack_id` CHAR(36) NOT NULL,
    `version` INTEGER NOT NULL,
    `rules` JSON NOT NULL,
    `effective_from` DATE NOT NULL,
    `effective_to` DATE NULL,
    `checksum` CHAR(64) NOT NULL,
    `reviewed_by` VARCHAR(120) NULL,
    `published_at` DATETIME(3) NOT NULL,

    INDEX `statutory_rule_versions_pack_id_effective_from_idx`(`pack_id`, `effective_from`),
    UNIQUE INDEX `statutory_rule_versions_pack_id_version_key`(`pack_id`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `jurisdiction_policies` (
    `id` CHAR(36) NOT NULL,
    `country_code` CHAR(2) NOT NULL,
    `region_code` VARCHAR(10) NOT NULL DEFAULT '',
    `version` INTEGER NOT NULL,
    `screenshots_allowed` ENUM('ALLOWED', 'ALLOWED_WITH_STEPS', 'NOT_ALLOWED', 'UNKNOWN') NOT NULL,
    `activity_allowed` ENUM('ALLOWED', 'ALLOWED_WITH_STEPS', 'NOT_ALLOWED', 'UNKNOWN') NOT NULL,
    `required_steps` JSON NOT NULL,
    `max_retention_days` INTEGER NULL,
    `min_notice_days` INTEGER NOT NULL DEFAULT 7,
    `legal_reviewed_on` DATE NULL,
    `effective_from` DATE NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `jurisdiction_policies_country_code_region_code_version_key`(`country_code`, `region_code`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `public_holiday_sets` (
    `id` CHAR(36) NOT NULL,
    `country_code` CHAR(2) NOT NULL,
    `region_code` VARCHAR(10) NOT NULL DEFAULT '',
    `year` INTEGER NOT NULL,
    `holidays` JSON NOT NULL,
    `source` VARCHAR(60) NOT NULL,

    UNIQUE INDEX `public_holiday_sets_country_code_region_code_year_key`(`country_code`, `region_code`, `year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `feature_flags` (
    `key` VARCHAR(80) NOT NULL,
    `description` VARCHAR(255) NOT NULL,
    `default_on` BOOLEAN NOT NULL DEFAULT false,
    `rules` JSON NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_webhook_events` (
    `id` CHAR(36) NOT NULL,
    `provider` ENUM('STRIPE', 'RAZORPAY', 'MANUAL') NOT NULL,
    `event_id` VARCHAR(120) NOT NULL,
    `type` VARCHAR(80) NOT NULL,
    `payload` JSON NOT NULL,
    `processed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `payment_webhook_events_provider_event_id_key`(`provider`, `event_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tenants` (
    `id` CHAR(36) NOT NULL,
    `slug` VARCHAR(63) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `status` ENUM('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED') NOT NULL DEFAULT 'TRIAL',
    `region` VARCHAR(20) NOT NULL,
    `country_code` CHAR(2) NOT NULL,
    `default_currency` CHAR(3) NOT NULL,
    `default_locale` VARCHAR(16) NOT NULL DEFAULT 'en',
    `timezone` VARCHAR(64) NOT NULL,
    `plan_id` CHAR(36) NULL,
    `trial_ends_at` DATETIME(3) NULL,
    `suspended_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tenants_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tenant_memberships` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NULL,
    `status` ENUM('INVITED', 'ACTIVE', 'SUSPENDED', 'REMOVED') NOT NULL DEFAULT 'INVITED',
    `invited_at` DATETIME(3) NULL,
    `joined_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `tenant_memberships_user_id_idx`(`user_id`),
    UNIQUE INDEX `tenant_memberships_tenant_id_id_key`(`tenant_id`, `id`),
    UNIQUE INDEX `tenant_memberships_tenant_id_user_id_key`(`tenant_id`, `user_id`),
    UNIQUE INDEX `tenant_memberships_tenant_id_employee_id_key`(`tenant_id`, `employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roles` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `description` VARCHAR(255) NULL,
    `is_system` BOOLEAN NOT NULL DEFAULT false,
    `system_key` VARCHAR(40) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `roles_tenant_id_id_key`(`tenant_id`, `id`),
    UNIQUE INDEX `roles_tenant_id_name_key`(`tenant_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_permissions` (
    `tenant_id` CHAR(36) NOT NULL,
    `role_id` CHAR(36) NOT NULL,
    `permission_code` VARCHAR(80) NOT NULL,
    `scope` ENUM('OWN', 'TEAM', 'DEPARTMENT', 'BRANCH', 'LEGAL_ENTITY', 'COMPANY') NOT NULL,

    INDEX `role_permissions_tenant_id_permission_code_idx`(`tenant_id`, `permission_code`),
    PRIMARY KEY (`role_id`, `permission_code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `membership_roles` (
    `tenant_id` CHAR(36) NOT NULL,
    `membership_id` CHAR(36) NOT NULL,
    `role_id` CHAR(36) NOT NULL,
    `granted_by` CHAR(36) NULL,
    `granted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `membership_roles_tenant_id_role_id_idx`(`tenant_id`, `role_id`),
    PRIMARY KEY (`membership_id`, `role_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `break_glass_grants` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `platform_admin_id` CHAR(36) NOT NULL,
    `reason` TEXT NOT NULL,
    `status` ENUM('REQUESTED', 'APPROVED', 'REJECTED', 'EXPIRED', 'REVOKED') NOT NULL DEFAULT 'REQUESTED',
    `approved_by` CHAR(36) NULL,
    `starts_at` DATETIME(3) NULL,
    `expires_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `break_glass_grants_tenant_id_status_idx`(`tenant_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscriptions` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `plan_id` CHAR(36) NOT NULL,
    `status` ENUM('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'INCOMPLETE') NOT NULL,
    `provider` ENUM('STRIPE', 'RAZORPAY', 'MANUAL') NOT NULL,
    `provider_subscription_id` VARCHAR(120) NULL,
    `currency` CHAR(3) NOT NULL,
    `seats` INTEGER NOT NULL,
    `addons` JSON NOT NULL,
    `current_period_start` DATETIME(3) NOT NULL,
    `current_period_end` DATETIME(3) NOT NULL,
    `cancel_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `subscriptions_tenant_id_status_idx`(`tenant_id`, `status`),
    UNIQUE INDEX `subscriptions_tenant_id_id_key`(`tenant_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoices` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `subscription_id` CHAR(36) NOT NULL,
    `number` VARCHAR(40) NOT NULL,
    `status` ENUM('DRAFT', 'OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE') NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `subtotal` DECIMAL(19, 4) NOT NULL,
    `tax` DECIMAL(19, 4) NOT NULL,
    `total` DECIMAL(19, 4) NOT NULL,
    `provider_invoice_id` VARCHAR(120) NULL,
    `pdf_key` VARCHAR(500) NULL,
    `issued_at` DATETIME(3) NOT NULL,
    `due_at` DATETIME(3) NULL,
    `paid_at` DATETIME(3) NULL,

    UNIQUE INDEX `invoices_tenant_id_number_key`(`tenant_id`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `usage_snapshots` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `period_date` DATE NOT NULL,
    `active_employees` INTEGER NOT NULL,
    `monitored_employees` INTEGER NOT NULL,
    `storage_bytes` BIGINT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `usage_snapshots_tenant_id_period_date_key`(`tenant_id`, `period_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NULL,
    `actor_type` ENUM('USER', 'DEVICE', 'SYSTEM', 'PLATFORM_ADMIN') NOT NULL,
    `actor_user_id` CHAR(36) NULL,
    `action` VARCHAR(80) NOT NULL,
    `entity_type` VARCHAR(60) NOT NULL,
    `entity_id` CHAR(36) NULL,
    `changes` JSON NULL,
    `ip_address` VARCHAR(45) NULL,
    `user_agent` VARCHAR(255) NULL,
    `request_id` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_tenant_id_created_at_idx`(`tenant_id`, `created_at`),
    INDEX `audit_logs_tenant_id_entity_type_entity_id_idx`(`tenant_id`, `entity_type`, `entity_id`),
    INDEX `audit_logs_tenant_id_actor_user_id_created_at_idx`(`tenant_id`, `actor_user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `outbox_events` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tenant_id` CHAR(36) NULL,
    `topic` VARCHAR(80) NOT NULL,
    `payload` JSON NOT NULL,
    `available_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `published_at` DATETIME(3) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `outbox_events_published_at_available_at_idx`(`published_at`, `available_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `idempotency_records` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `scope` VARCHAR(80) NOT NULL,
    `key` VARCHAR(120) NOT NULL,
    `request_hash` CHAR(64) NOT NULL,
    `response_status` INTEGER NULL,
    `response_body` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,

    INDEX `idempotency_records_expires_at_idx`(`expires_at`),
    UNIQUE INDEX `idempotency_records_tenant_id_scope_key_key`(`tenant_id`, `scope`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `recipient_user_id` CHAR(36) NOT NULL,
    `type` VARCHAR(60) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `body` TEXT NULL,
    `link` VARCHAR(500) NULL,
    `read_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_tenant_id_recipient_user_id_read_at_idx`(`tenant_id`, `recipient_user_id`, `read_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `message_templates` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NULL,
    `key` VARCHAR(80) NOT NULL,
    `locale` VARCHAR(16) NOT NULL,
    `channel` ENUM('EMAIL', 'IN_APP') NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `subject` VARCHAR(200) NULL,
    `body` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `message_templates_tenant_id_key_locale_channel_version_key`(`tenant_id`, `key`, `locale`, `channel`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `legal_entities` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `country_code` CHAR(2) NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `registration_number` VARCHAR(80) NULL,
    `tax_ids` JSON NULL,
    `fiscal_year_start_month` INTEGER NOT NULL DEFAULT 1,
    `week_start_day` INTEGER NOT NULL DEFAULT 1,
    `weekend_days` JSON NOT NULL,
    `timezone` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `legal_entities_tenant_id_id_key`(`tenant_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `branches` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `legal_entity_id` CHAR(36) NOT NULL,
    `holiday_calendar_id` CHAR(36) NULL,
    `name` VARCHAR(150) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `address` JSON NULL,
    `timezone` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `branches_tenant_id_id_key`(`tenant_id`, `id`),
    UNIQUE INDEX `branches_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `departments` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `parent_id` CHAR(36) NULL,
    `name` VARCHAR(150) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `head_employee_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `departments_tenant_id_id_key`(`tenant_id`, `id`),
    UNIQUE INDEX `departments_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `designations` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `title` VARCHAR(150) NOT NULL,
    `level` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `designations_tenant_id_id_key`(`tenant_id`, `id`),
    UNIQUE INDEX `designations_tenant_id_title_key`(`tenant_id`, `title`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `teams` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `department_id` CHAR(36) NULL,
    `name` VARCHAR(150) NOT NULL,
    `lead_employee_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `teams_tenant_id_id_key`(`tenant_id`, `id`),
    UNIQUE INDEX `teams_tenant_id_name_key`(`tenant_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `team_members` (
    `tenant_id` CHAR(36) NOT NULL,
    `team_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `joined_at` DATE NOT NULL,

    INDEX `team_members_tenant_id_employee_id_idx`(`tenant_id`, `employee_id`),
    PRIMARY KEY (`team_id`, `employee_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `work_schedules` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `type` ENUM('FIXED', 'FLEXIBLE', 'SHIFT') NOT NULL,
    `weekly_pattern` JSON NOT NULL,
    `daily_minutes` INTEGER NOT NULL,
    `grace_minutes` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `work_schedules_tenant_id_id_key`(`tenant_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `holiday_calendars` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `country_code` CHAR(2) NOT NULL,
    `region_code` VARCHAR(10) NOT NULL DEFAULT '',
    `year` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `holiday_calendars_tenant_id_id_key`(`tenant_id`, `id`),
    UNIQUE INDEX `holiday_calendars_tenant_id_name_year_key`(`tenant_id`, `name`, `year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `holidays` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `calendar_id` CHAR(36) NOT NULL,
    `date` DATE NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `is_optional` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `holidays_tenant_id_calendar_id_date_name_key`(`tenant_id`, `calendar_id`, `date`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `company_policies` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `category` VARCHAR(60) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `document_key` VARCHAR(500) NULL,
    `body` TEXT NULL,
    `requires_ack` BOOLEAN NOT NULL DEFAULT false,
    `published_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `company_policies_tenant_id_id_key`(`tenant_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `policy_acknowledgements` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `policy_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `acknowledged_at` DATETIME(3) NOT NULL,
    `ip_address` VARCHAR(45) NULL,

    UNIQUE INDEX `policy_acknowledgements_tenant_id_policy_id_employee_id_key`(`tenant_id`, `policy_id`, `employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `announcements` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `body` TEXT NOT NULL,
    `audience` JSON NOT NULL,
    `published_at` DATETIME(3) NULL,
    `expires_at` DATETIME(3) NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `announcements_tenant_id_published_at_idx`(`tenant_id`, `published_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employees` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `legal_entity_id` CHAR(36) NOT NULL,
    `employee_code` VARCHAR(40) NOT NULL,
    `first_name` VARCHAR(100) NOT NULL,
    `middle_name` VARCHAR(100) NULL,
    `last_name` VARCHAR(100) NULL,
    `preferred_name` VARCHAR(100) NULL,
    `work_email` VARCHAR(254) NULL,
    `personal_email` VARCHAR(254) NULL,
    `phone` VARCHAR(32) NULL,
    `date_of_birth` DATE NULL,
    `gender` VARCHAR(20) NULL,
    `nationality` CHAR(2) NULL,
    `work_country` CHAR(2) NOT NULL,
    `locale` VARCHAR(16) NOT NULL DEFAULT 'en',
    `timezone` VARCHAR(64) NOT NULL,
    `pay_currency` CHAR(3) NOT NULL,
    `date_of_joining` DATE NOT NULL,
    `probation_end_date` DATE NULL,
    `exit_date` DATE NULL,
    `status` ENUM('PREBOARDING', 'PROBATION', 'ACTIVE', 'NOTICE', 'EXITED') NOT NULL DEFAULT 'PREBOARDING',
    `work_mode` ENUM('OFFICE', 'REMOTE', 'HYBRID') NOT NULL DEFAULT 'OFFICE',
    `employment_type` ENUM('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN') NOT NULL DEFAULT 'FULL_TIME',
    `department_id` CHAR(36) NULL,
    `designation_id` CHAR(36) NULL,
    `branch_id` CHAR(36) NULL,
    `manager_id` CHAR(36) NULL,
    `country_fields` JSON NULL,
    `national_id_type` VARCHAR(30) NULL,
    `national_id_enc` VARBINARY(512) NULL,
    `national_id_index` CHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `employees_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `employees_tenant_id_last_name_first_name_idx`(`tenant_id`, `last_name`, `first_name`),
    INDEX `employees_tenant_id_manager_id_idx`(`tenant_id`, `manager_id`),
    UNIQUE INDEX `employees_tenant_id_id_key`(`tenant_id`, `id`),
    UNIQUE INDEX `employees_tenant_id_employee_code_key`(`tenant_id`, `employee_code`),
    UNIQUE INDEX `employees_tenant_id_national_id_index_key`(`tenant_id`, `national_id_index`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employment_records` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `department_id` CHAR(36) NULL,
    `designation_id` CHAR(36) NULL,
    `branch_id` CHAR(36) NULL,
    `manager_id` CHAR(36) NULL,
    `schedule_id` CHAR(36) NULL,
    `change_reason` VARCHAR(60) NOT NULL,
    `effective_from` DATE NOT NULL,
    `effective_to` DATE NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `employment_records_tenant_id_employee_id_effective_from_idx`(`tenant_id`, `employee_id`, `effective_from`),
    INDEX `employment_records_tenant_id_manager_id_idx`(`tenant_id`, `manager_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_hierarchies` (
    `tenant_id` CHAR(36) NOT NULL,
    `ancestor_id` CHAR(36) NOT NULL,
    `descendant_id` CHAR(36) NOT NULL,
    `depth` INTEGER NOT NULL,

    INDEX `employee_hierarchies_tenant_id_descendant_id_idx`(`tenant_id`, `descendant_id`),
    PRIMARY KEY (`tenant_id`, `ancestor_id`, `descendant_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_documents` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `category` VARCHAR(40) NOT NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `s3_key` VARCHAR(500) NOT NULL,
    `mime_type` VARCHAR(100) NOT NULL,
    `size_bytes` INTEGER NOT NULL,
    `sha256` CHAR(64) NULL,
    `scan_status` ENUM('PENDING', 'CLEAN', 'INFECTED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `verified_at` DATETIME(3) NULL,
    `verified_by` CHAR(36) NULL,
    `expires_on` DATE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `employee_documents_tenant_id_employee_id_idx`(`tenant_id`, `employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_bank_accounts` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `account_holder` VARCHAR(150) NOT NULL,
    `account_number_enc` VARBINARY(512) NOT NULL,
    `account_number_last4` CHAR(4) NOT NULL,
    `bank_fields` JSON NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `is_primary` BOOLEAN NOT NULL DEFAULT true,
    `effective_from` DATE NOT NULL,
    `effective_to` DATE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `employee_bank_accounts_tenant_id_employee_id_effective_from_idx`(`tenant_id`, `employee_id`, `effective_from`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `emergency_contacts` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `relationship` VARCHAR(40) NOT NULL,
    `phone` VARCHAR(32) NOT NULL,
    `email` VARCHAR(254) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `emergency_contacts_tenant_id_employee_id_idx`(`tenant_id`, `employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bulk_import_jobs` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `type` ENUM('EMPLOYEES', 'ATTENDANCE', 'SALARIES') NOT NULL,
    `file_key` VARCHAR(500) NOT NULL,
    `file_sha256` CHAR(64) NOT NULL,
    `status` ENUM('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'PARTIAL') NOT NULL DEFAULT 'QUEUED',
    `total_rows` INTEGER NULL,
    `ok_rows` INTEGER NULL,
    `error_rows` INTEGER NULL,
    `result_key` VARCHAR(500) NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finished_at` DATETIME(3) NULL,

    UNIQUE INDEX `bulk_import_jobs_tenant_id_type_file_sha256_key`(`tenant_id`, `type`, `file_sha256`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `approval_steps` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `entity_type` ENUM('LEAVE_REQUEST', 'WFH_REQUEST', 'ATTENDANCE_REGULARIZATION', 'WORK_CORRECTION', 'DAILY_WORK_REPORT', 'TIMESHEET', 'JOB_REQUISITION', 'OFFER', 'PAYROLL_RUN') NOT NULL,
    `entity_id` CHAR(36) NOT NULL,
    `step_no` INTEGER NOT NULL,
    `approver_employee_id` CHAR(36) NULL,
    `approver_role_id` CHAR(36) NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'SKIPPED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `decided_at` DATETIME(3) NULL,
    `decided_by` CHAR(36) NULL,
    `comment` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `approval_steps_tenant_id_approver_employee_id_status_idx`(`tenant_id`, `approver_employee_id`, `status`),
    UNIQUE INDEX `approval_steps_tenant_id_entity_type_entity_id_step_no_key`(`tenant_id`, `entity_type`, `entity_id`, `step_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `data_subject_requests` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NULL,
    `requester_email` VARCHAR(254) NOT NULL,
    `type` ENUM('ACCESS', 'CORRECTION', 'ERASURE', 'OBJECTION', 'RESTRICTION', 'PORTABILITY', 'GRIEVANCE') NOT NULL,
    `regime` VARCHAR(20) NOT NULL,
    `status` ENUM('RECEIVED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED') NOT NULL DEFAULT 'RECEIVED',
    `due_at` DATETIME(3) NOT NULL,
    `closed_at` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `data_subject_requests_tenant_id_status_due_at_idx`(`tenant_id`, `status`, `due_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `helpdesk_tickets` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `assignee_employee_id` CHAR(36) NULL,
    `category` VARCHAR(60) NOT NULL,
    `subject` VARCHAR(200) NOT NULL,
    `body` TEXT NOT NULL,
    `status` ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `closed_at` DATETIME(3) NULL,

    INDEX `helpdesk_tickets_tenant_id_status_idx`(`tenant_id`, `status`),
    INDEX `helpdesk_tickets_tenant_id_employee_id_idx`(`tenant_id`, `employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `shifts` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `start_min` INTEGER NOT NULL,
    `end_min` INTEGER NOT NULL,
    `crosses_midnight` BOOLEAN NOT NULL DEFAULT false,
    `break_minutes` INTEGER NOT NULL DEFAULT 0,
    `grace_late_min` INTEGER NOT NULL DEFAULT 0,
    `grace_early_min` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `shifts_tenant_id_id_key`(`tenant_id`, `id`),
    UNIQUE INDEX `shifts_tenant_id_name_key`(`tenant_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `shift_assignments` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `shift_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `effective_from` DATE NOT NULL,
    `effective_to` DATE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `shift_assignments_tenant_id_employee_id_effective_from_idx`(`tenant_id`, `employee_id`, `effective_from`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `overtime_rules` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `legal_entity_id` CHAR(36) NULL,
    `name` VARCHAR(100) NOT NULL,
    `daily_threshold_min` INTEGER NULL,
    `weekly_threshold_min` INTEGER NULL,
    `multiplier` DECIMAL(9, 6) NOT NULL,
    `requires_approval` BOOLEAN NOT NULL DEFAULT true,
    `effective_from` DATE NOT NULL,
    `effective_to` DATE NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance_punches` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `type` ENUM('IN', 'OUT') NOT NULL,
    `server_ts` DATETIME(3) NOT NULL,
    `client_ts` DATETIME(3) NULL,
    `source` ENUM('WEB', 'MOBILE', 'DESKTOP_AGENT', 'BIOMETRIC', 'IMPORT', 'CORRECTION') NOT NULL,
    `work_location_id` CHAR(36) NULL,
    `work_session_id` CHAR(36) NULL,
    `ip_address` VARCHAR(45) NULL,
    `geo` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `attendance_punches_tenant_id_employee_id_server_ts_idx`(`tenant_id`, `employee_id`, `server_ts`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance_days` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `work_date` DATE NOT NULL,
    `status` ENUM('PRESENT', 'ABSENT', 'HALF_DAY', 'ON_LEAVE', 'HOLIDAY', 'WEEKEND', 'WFH', 'PENDING') NOT NULL DEFAULT 'PENDING',
    `first_in_at` DATETIME(3) NULL,
    `last_out_at` DATETIME(3) NULL,
    `worked_minutes` INTEGER NOT NULL DEFAULT 0,
    `break_minutes` INTEGER NOT NULL DEFAULT 0,
    `late_minutes` INTEGER NOT NULL DEFAULT 0,
    `early_leave_minutes` INTEGER NOT NULL DEFAULT 0,
    `overtime_minutes` INTEGER NOT NULL DEFAULT 0,
    `work_location_id` CHAR(36) NULL,
    `is_locked` BOOLEAN NOT NULL DEFAULT false,
    `computed_at` DATETIME(3) NOT NULL,

    INDEX `attendance_days_tenant_id_work_date_status_idx`(`tenant_id`, `work_date`, `status`),
    UNIQUE INDEX `attendance_days_tenant_id_id_key`(`tenant_id`, `id`),
    UNIQUE INDEX `attendance_days_tenant_id_employee_id_work_date_key`(`tenant_id`, `employee_id`, `work_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance_regularizations` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `attendance_day_id` CHAR(36) NOT NULL,
    `requested_in` DATETIME(3) NULL,
    `requested_out` DATETIME(3) NULL,
    `reason` TEXT NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `decided_at` DATETIME(3) NULL,

    INDEX `attendance_regularizations_tenant_id_employee_id_status_idx`(`tenant_id`, `employee_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leave_types` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `is_paid` BOOLEAN NOT NULL DEFAULT true,
    `unit` ENUM('DAY', 'HOUR') NOT NULL DEFAULT 'DAY',
    `is_system` BOOLEAN NOT NULL DEFAULT false,
    `allow_negative` BOOLEAN NOT NULL DEFAULT false,
    `requires_document_after_days` INTEGER NULL,
    `color` VARCHAR(9) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `leave_types_tenant_id_id_key`(`tenant_id`, `id`),
    UNIQUE INDEX `leave_types_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leave_policies` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `leave_type_id` CHAR(36) NOT NULL,
    `legal_entity_id` CHAR(36) NULL,
    `name` VARCHAR(120) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `rules` JSON NOT NULL,
    `effective_from` DATE NOT NULL,
    `effective_to` DATE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `leave_policies_tenant_id_leave_type_id_effective_from_idx`(`tenant_id`, `leave_type_id`, `effective_from`),
    UNIQUE INDEX `leave_policies_tenant_id_id_key`(`tenant_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leave_policy_assignments` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `policy_id` CHAR(36) NOT NULL,
    `applies_to` ENUM('COMPANY', 'LEGAL_ENTITY', 'BRANCH', 'DEPARTMENT', 'TEAM', 'EMPLOYEE') NOT NULL,
    `target_id` CHAR(36) NULL,
    `effective_from` DATE NOT NULL,
    `effective_to` DATE NULL,

    INDEX `leave_policy_assignments_tenant_id_applies_to_target_id_idx`(`tenant_id`, `applies_to`, `target_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leave_ledger_entries` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `leave_type_id` CHAR(36) NOT NULL,
    `entry_type` ENUM('OPENING_BALANCE', 'ACCRUAL', 'ADJUSTMENT', 'CONSUMPTION', 'REVERSAL', 'CARRY_FORWARD', 'EXPIRY', 'ENCASHMENT') NOT NULL,
    `quantity` DECIMAL(8, 2) NOT NULL,
    `posted_on` DATE NOT NULL,
    `period_key` VARCHAR(20) NULL,
    `source_type` VARCHAR(40) NOT NULL,
    `source_id` CHAR(36) NULL,
    `note` VARCHAR(255) NULL,
    `created_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `leave_ledger_entries_tenant_id_employee_id_leave_type_id_pos_idx`(`tenant_id`, `employee_id`, `leave_type_id`, `posted_on`),
    UNIQUE INDEX `leave_ledger_entries_tenant_id_employee_id_leave_type_id_ent_key`(`tenant_id`, `employee_id`, `leave_type_id`, `entry_type`, `period_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leave_requests` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `leave_type_id` CHAR(36) NOT NULL,
    `from_date` DATE NOT NULL,
    `to_date` DATE NOT NULL,
    `from_half_day` BOOLEAN NOT NULL DEFAULT false,
    `to_half_day` BOOLEAN NOT NULL DEFAULT false,
    `total_quantity` DECIMAL(8, 2) NOT NULL,
    `reason` TEXT NULL,
    `document_key` VARCHAR(500) NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `cancelled_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `leave_requests_tenant_id_employee_id_from_date_idx`(`tenant_id`, `employee_id`, `from_date`),
    INDEX `leave_requests_tenant_id_status_idx`(`tenant_id`, `status`),
    UNIQUE INDEX `leave_requests_tenant_id_id_key`(`tenant_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leave_request_days` (
    `tenant_id` CHAR(36) NOT NULL,
    `request_id` CHAR(36) NOT NULL,
    `date` DATE NOT NULL,
    `quantity` DECIMAL(8, 2) NOT NULL,

    INDEX `leave_request_days_tenant_id_date_idx`(`tenant_id`, `date`),
    PRIMARY KEY (`request_id`, `date`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `salary_components` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `kind` ENUM('EARNING', 'DEDUCTION', 'EMPLOYER_CONTRIBUTION', 'REIMBURSEMENT', 'INFORMATIONAL') NOT NULL,
    `calc_type` ENUM('FIXED', 'PERCENTAGE', 'FORMULA', 'STATUTORY', 'INPUT') NOT NULL,
    `formula` TEXT NULL,
    `percent_of` VARCHAR(40) NULL,
    `rate` DECIMAL(9, 6) NULL,
    `fixed_amount` DECIMAL(19, 4) NULL,
    `taxable` BOOLEAN NOT NULL DEFAULT true,
    `rounding_rule` ENUM('HALF_UP', 'HALF_EVEN', 'UP', 'DOWN', 'NONE') NOT NULL DEFAULT 'HALF_UP',
    `statutory_key` VARCHAR(60) NULL,
    `display_order` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `salary_components_tenant_id_id_key`(`tenant_id`, `id`),
    UNIQUE INDEX `salary_components_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `salary_structures` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `legal_entity_id` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `effective_from` DATE NOT NULL,
    `effective_to` DATE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `salary_structures_tenant_id_id_key`(`tenant_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `salary_structure_components` (
    `tenant_id` CHAR(36) NOT NULL,
    `structure_id` CHAR(36) NOT NULL,
    `component_id` CHAR(36) NOT NULL,
    `sequence` INTEGER NOT NULL,
    `override_formula` TEXT NULL,
    `override_rate` DECIMAL(9, 6) NULL,

    INDEX `salary_structure_components_tenant_id_component_id_idx`(`tenant_id`, `component_id`),
    PRIMARY KEY (`structure_id`, `component_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_salaries` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `structure_id` CHAR(36) NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `annual_ctc` DECIMAL(19, 4) NOT NULL,
    `pay_frequency` ENUM('MONTHLY', 'SEMI_MONTHLY', 'BIWEEKLY', 'WEEKLY') NOT NULL DEFAULT 'MONTHLY',
    `effective_from` DATE NOT NULL,
    `effective_to` DATE NULL,
    `reason` VARCHAR(60) NOT NULL,
    `approved_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `employee_salaries_tenant_id_employee_id_effective_from_idx`(`tenant_id`, `employee_id`, `effective_from`),
    UNIQUE INDEX `employee_salaries_tenant_id_id_key`(`tenant_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_salary_lines` (
    `tenant_id` CHAR(36) NOT NULL,
    `employee_salary_id` CHAR(36) NOT NULL,
    `component_id` CHAR(36) NOT NULL,
    `amount` DECIMAL(19, 4) NOT NULL,
    `period` ENUM('ANNUAL', 'MONTHLY') NOT NULL,

    INDEX `employee_salary_lines_tenant_id_component_id_idx`(`tenant_id`, `component_id`),
    PRIMARY KEY (`employee_salary_id`, `component_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tenant_statutory_settings` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `legal_entity_id` CHAR(36) NOT NULL,
    `pack_id` CHAR(36) NOT NULL,
    `overrides` JSON NOT NULL,
    `registration_numbers` JSON NULL,
    `effective_from` DATE NOT NULL,
    `effective_to` DATE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `tenant_statutory_settings_tenant_id_legal_entity_id_effectiv_idx`(`tenant_id`, `legal_entity_id`, `effective_from`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_periods` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `legal_entity_id` CHAR(36) NOT NULL,
    `frequency` ENUM('MONTHLY', 'SEMI_MONTHLY', 'BIWEEKLY', 'WEEKLY') NOT NULL,
    `start_date` DATE NOT NULL,
    `end_date` DATE NOT NULL,
    `pay_date` DATE NOT NULL,
    `status` ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN',

    UNIQUE INDEX `payroll_periods_tenant_id_id_key`(`tenant_id`, `id`),
    UNIQUE INDEX `payroll_periods_tenant_id_legal_entity_id_frequency_start_da_key`(`tenant_id`, `legal_entity_id`, `frequency`, `start_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_runs` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `period_id` CHAR(36) NOT NULL,
    `type` ENUM('REGULAR', 'OFF_CYCLE', 'FNF', 'ADJUSTMENT') NOT NULL DEFAULT 'REGULAR',
    `status` ENUM('DRAFT', 'INPUTS_LOCKED', 'CALCULATING', 'CALCULATED', 'REVIEWED', 'APPROVED', 'FINALIZED', 'PAID', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `currency` CHAR(3) NOT NULL,
    `engine_version` VARCHAR(40) NULL,
    `rule_versions_pinned` JSON NULL,
    `totals` JSON NULL,
    `inputs_locked_at` DATETIME(3) NULL,
    `calculated_at` DATETIME(3) NULL,
    `reviewed_by` CHAR(36) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `approved_by` CHAR(36) NULL,
    `approved_at` DATETIME(3) NULL,
    `finalized_at` DATETIME(3) NULL,
    `paid_at` DATETIME(3) NULL,
    `final_hash` CHAR(64) NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `payroll_runs_tenant_id_period_id_idx`(`tenant_id`, `period_id`),
    INDEX `payroll_runs_tenant_id_status_idx`(`tenant_id`, `status`),
    UNIQUE INDEX `payroll_runs_tenant_id_id_key`(`tenant_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_run_employees` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `run_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `employee_salary_id` CHAR(36) NULL,
    `currency` CHAR(3) NOT NULL,
    `paid_days` DECIMAL(8, 2) NOT NULL,
    `lop_days` DECIMAL(8, 2) NOT NULL,
    `gross` DECIMAL(19, 4) NOT NULL,
    `deductions` DECIMAL(19, 4) NOT NULL,
    `employer_cost` DECIMAL(19, 4) NOT NULL,
    `net` DECIMAL(19, 4) NOT NULL,
    `status` ENUM('OK', 'WARNING', 'ERROR', 'EXCLUDED') NOT NULL DEFAULT 'OK',
    `errors` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payroll_run_employees_tenant_id_employee_id_idx`(`tenant_id`, `employee_id`),
    UNIQUE INDEX `payroll_run_employees_tenant_id_id_key`(`tenant_id`, `id`),
    UNIQUE INDEX `payroll_run_employees_tenant_id_run_id_employee_id_key`(`tenant_id`, `run_id`, `employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_lines` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `run_employee_id` CHAR(36) NOT NULL,
    `component_id` CHAR(36) NULL,
    `code` VARCHAR(40) NOT NULL,
    `label` VARCHAR(120) NOT NULL,
    `kind` ENUM('EARNING', 'DEDUCTION', 'EMPLOYER_CONTRIBUTION', 'REIMBURSEMENT', 'INFORMATIONAL') NOT NULL,
    `amount` DECIMAL(19, 4) NOT NULL,
    `sequence` INTEGER NOT NULL,
    `calc_trace` JSON NULL,

    INDEX `payroll_lines_tenant_id_run_employee_id_idx`(`tenant_id`, `run_employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_inputs` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `run_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `component_id` CHAR(36) NOT NULL,
    `amount` DECIMAL(19, 4) NOT NULL,
    `note` VARCHAR(255) NULL,
    `source_type` VARCHAR(40) NOT NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payroll_inputs_tenant_id_run_id_employee_id_idx`(`tenant_id`, `run_id`, `employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payslips` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `run_employee_id` CHAR(36) NOT NULL,
    `s3_key` VARCHAR(500) NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `locale` VARCHAR(16) NOT NULL,
    `generated_at` DATETIME(3) NOT NULL,
    `published_at` DATETIME(3) NULL,

    UNIQUE INDEX `payslips_tenant_id_run_employee_id_key`(`tenant_id`, `run_employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tax_declarations` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `fiscal_year` VARCHAR(9) NOT NULL,
    `regime` VARCHAR(20) NULL,
    `declarations` JSON NOT NULL,
    `proofs` JSON NULL,
    `status` ENUM('DRAFT', 'SUBMITTED', 'VERIFIED', 'REJECTED') NOT NULL DEFAULT 'DRAFT',
    `submitted_at` DATETIME(3) NULL,
    `reviewed_by` CHAR(36) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tax_declarations_tenant_id_employee_id_fiscal_year_key`(`tenant_id`, `employee_id`, `fiscal_year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fnf_settlements` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `run_id` CHAR(36) NULL,
    `last_working_date` DATE NOT NULL,
    `status` ENUM('INITIATED', 'CALCULATED', 'APPROVED', 'PAID') NOT NULL DEFAULT 'INITIATED',
    `summary` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `fnf_settlements_tenant_id_employee_id_key`(`tenant_id`, `employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `job_requisitions` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `department_id` CHAR(36) NULL,
    `designation_id` CHAR(36) NULL,
    `title` VARCHAR(200) NOT NULL,
    `headcount` INTEGER NOT NULL DEFAULT 1,
    `employment_type` ENUM('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN') NOT NULL,
    `location` VARCHAR(150) NULL,
    `budget_currency` CHAR(3) NULL,
    `budget_min` DECIMAL(19, 4) NULL,
    `budget_max` DECIMAL(19, 4) NULL,
    `justification` TEXT NULL,
    `status` ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'ON_HOLD', 'CLOSED') NOT NULL DEFAULT 'DRAFT',
    `requested_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `job_requisitions_tenant_id_id_key`(`tenant_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `job_postings` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `requisition_id` CHAR(36) NOT NULL,
    `slug` VARCHAR(120) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `description` TEXT NOT NULL,
    `location` VARCHAR(150) NULL,
    `work_mode` ENUM('OFFICE', 'REMOTE', 'HYBRID') NOT NULL,
    `is_public` BOOLEAN NOT NULL DEFAULT true,
    `status` ENUM('DRAFT', 'PUBLISHED', 'PAUSED', 'CLOSED') NOT NULL DEFAULT 'DRAFT',
    `pipeline_stages` JSON NOT NULL,
    `published_at` DATETIME(3) NULL,
    `closes_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `job_postings_tenant_id_id_key`(`tenant_id`, `id`),
    UNIQUE INDEX `job_postings_tenant_id_slug_key`(`tenant_id`, `slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `candidates` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `first_name` VARCHAR(100) NOT NULL,
    `last_name` VARCHAR(100) NULL,
    `email` VARCHAR(254) NOT NULL,
    `phone` VARCHAR(32) NULL,
    `resume_key` VARCHAR(500) NULL,
    `parsed_profile` JSON NULL,
    `source` VARCHAR(40) NOT NULL,
    `consent_talent_pool` BOOLEAN NOT NULL DEFAULT false,
    `retention_until` DATE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `candidates_tenant_id_id_key`(`tenant_id`, `id`),
    UNIQUE INDEX `candidates_tenant_id_email_key`(`tenant_id`, `email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `job_applications` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `posting_id` CHAR(36) NOT NULL,
    `candidate_id` CHAR(36) NOT NULL,
    `stage` VARCHAR(40) NOT NULL,
    `status` ENUM('ACTIVE', 'HIRED', 'REJECTED', 'WITHDRAWN') NOT NULL DEFAULT 'ACTIVE',
    `applied_at` DATETIME(3) NOT NULL,
    `rejected_reason` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `job_applications_tenant_id_id_key`(`tenant_id`, `id`),
    UNIQUE INDEX `job_applications_tenant_id_posting_id_candidate_id_key`(`tenant_id`, `posting_id`, `candidate_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `interviews` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `application_id` CHAR(36) NOT NULL,
    `round` INTEGER NOT NULL,
    `scheduled_start` DATETIME(3) NOT NULL,
    `scheduled_end` DATETIME(3) NOT NULL,
    `mode` ENUM('ONSITE', 'VIDEO', 'PHONE') NOT NULL,
    `location_or_link` VARCHAR(500) NULL,
    `interviewer_employee_ids` JSON NOT NULL,
    `status` ENUM('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW') NOT NULL DEFAULT 'SCHEDULED',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `interviews_tenant_id_scheduled_start_idx`(`tenant_id`, `scheduled_start`),
    UNIQUE INDEX `interviews_tenant_id_id_key`(`tenant_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `interview_feedbacks` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `interview_id` CHAR(36) NOT NULL,
    `interviewer_employee_id` CHAR(36) NOT NULL,
    `rating` INTEGER NULL,
    `recommendation` ENUM('STRONG_YES', 'YES', 'NO', 'STRONG_NO') NOT NULL,
    `scorecard` JSON NOT NULL,
    `notes` TEXT NULL,
    `submitted_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `interview_feedbacks_tenant_id_interview_id_interviewer_emplo_key`(`tenant_id`, `interview_id`, `interviewer_employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `offers` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `application_id` CHAR(36) NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `annual_ctc` DECIMAL(19, 4) NOT NULL,
    `joining_date` DATE NULL,
    `letter_key` VARCHAR(500) NULL,
    `status` ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN') NOT NULL DEFAULT 'DRAFT',
    `sent_at` DATETIME(3) NULL,
    `responded_at` DATETIME(3) NULL,
    `expires_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `offers_tenant_id_id_key`(`tenant_id`, `id`),
    UNIQUE INDEX `offers_tenant_id_application_id_key`(`tenant_id`, `application_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `onboarding_templates` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `legal_entity_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `onboarding_templates_tenant_id_id_key`(`tenant_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `onboarding_template_tasks` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `template_id` CHAR(36) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `owner_role` ENUM('HR', 'IT', 'MANAGER', 'EMPLOYEE', 'FINANCE') NOT NULL,
    `due_offset_days` INTEGER NOT NULL DEFAULT 0,
    `requires_document` BOOLEAN NOT NULL DEFAULT false,
    `sequence` INTEGER NOT NULL,

    INDEX `onboarding_template_tasks_tenant_id_template_id_idx`(`tenant_id`, `template_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `onboarding_cases` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `offer_id` CHAR(36) NULL,
    `template_id` CHAR(36) NULL,
    `status` ENUM('PREBOARDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PREBOARDING',
    `start_date` DATE NOT NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `onboarding_cases_tenant_id_id_key`(`tenant_id`, `id`),
    UNIQUE INDEX `onboarding_cases_tenant_id_employee_id_key`(`tenant_id`, `employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `onboarding_tasks` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `case_id` CHAR(36) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `owner_role` ENUM('HR', 'IT', 'MANAGER', 'EMPLOYEE', 'FINANCE') NOT NULL,
    `assignee_employee_id` CHAR(36) NULL,
    `due_date` DATE NULL,
    `status` ENUM('PENDING', 'DONE', 'SKIPPED') NOT NULL DEFAULT 'PENDING',
    `completed_at` DATETIME(3) NULL,
    `completed_by` CHAR(36) NULL,

    INDEX `onboarding_tasks_tenant_id_case_id_idx`(`tenant_id`, `case_id`),
    INDEX `onboarding_tasks_tenant_id_assignee_employee_id_status_idx`(`tenant_id`, `assignee_employee_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `onboarding_documents` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `case_id` CHAR(36) NOT NULL,
    `category` VARCHAR(60) NOT NULL,
    `s3_key` VARCHAR(500) NULL,
    `status` ENUM('REQUESTED', 'UPLOADED', 'VERIFIED', 'REJECTED') NOT NULL DEFAULT 'REQUESTED',
    `verified_by` CHAR(36) NULL,
    `verified_at` DATETIME(3) NULL,
    `rejection_reason` VARCHAR(255) NULL,

    INDEX `onboarding_documents_tenant_id_case_id_idx`(`tenant_id`, `case_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assets` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `tag` VARCHAR(60) NOT NULL,
    `type` VARCHAR(40) NOT NULL,
    `description` VARCHAR(255) NULL,
    `serial_number` VARCHAR(120) NULL,
    `status` ENUM('IN_STOCK', 'ASSIGNED', 'RETURNED', 'RETIRED') NOT NULL DEFAULT 'IN_STOCK',
    `assigned_employee_id` CHAR(36) NULL,
    `assigned_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `assets_tenant_id_tag_key`(`tenant_id`, `tag`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `performance_cycles` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `start_date` DATE NOT NULL,
    `end_date` DATE NOT NULL,
    `status` ENUM('DRAFT', 'GOAL_SETTING', 'SELF_REVIEW', 'MANAGER_REVIEW', 'CALIBRATION', 'CLOSED') NOT NULL DEFAULT 'DRAFT',
    `settings` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `performance_cycles_tenant_id_id_key`(`tenant_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `goals` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `cycle_id` CHAR(36) NULL,
    `employee_id` CHAR(36) NOT NULL,
    `parent_goal_id` CHAR(36) NULL,
    `title` VARCHAR(250) NOT NULL,
    `description` TEXT NULL,
    `type` ENUM('OKR_OBJECTIVE', 'KEY_RESULT', 'KPI', 'PERSONAL') NOT NULL,
    `weight` DECIMAL(5, 2) NULL,
    `target_value` DECIMAL(19, 4) NULL,
    `current_value` DECIMAL(19, 4) NULL,
    `unit` VARCHAR(20) NULL,
    `status` ENUM('DRAFT', 'ACTIVE', 'AT_RISK', 'ACHIEVED', 'MISSED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `due_date` DATE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `goals_tenant_id_employee_id_cycle_id_idx`(`tenant_id`, `employee_id`, `cycle_id`),
    UNIQUE INDEX `goals_tenant_id_id_key`(`tenant_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `performance_reviews` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `cycle_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `reviewer_employee_id` CHAR(36) NULL,
    `status` ENUM('NOT_STARTED', 'SELF_IN_PROGRESS', 'MANAGER_IN_PROGRESS', 'CALIBRATING', 'COMPLETED') NOT NULL DEFAULT 'NOT_STARTED',
    `self_rating` DECIMAL(4, 2) NULL,
    `manager_rating` DECIMAL(4, 2) NULL,
    `final_rating` DECIMAL(4, 2) NULL,
    `summary` TEXT NULL,
    `submitted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `performance_reviews_tenant_id_id_key`(`tenant_id`, `id`),
    UNIQUE INDEX `performance_reviews_tenant_id_cycle_id_employee_id_key`(`tenant_id`, `cycle_id`, `employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `review_responses` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `review_id` CHAR(36) NOT NULL,
    `respondent_employee_id` CHAR(36) NOT NULL,
    `respondent_type` ENUM('SELF', 'MANAGER', 'PEER', 'DIRECT_REPORT') NOT NULL,
    `answers` JSON NOT NULL,
    `submitted_at` DATETIME(3) NULL,

    UNIQUE INDEX `review_responses_tenant_id_review_id_respondent_employee_id__key`(`tenant_id`, `review_id`, `respondent_employee_id`, `respondent_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `feedback_requests` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `review_id` CHAR(36) NOT NULL,
    `requested_from_employee_id` CHAR(36) NOT NULL,
    `status` ENUM('PENDING', 'SUBMITTED', 'DECLINED', 'EXPIRED') NOT NULL DEFAULT 'PENDING',
    `anonymous` BOOLEAN NOT NULL DEFAULT true,
    `due_date` DATE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `feedback_requests_tenant_id_requested_from_employee_id_statu_idx`(`tenant_id`, `requested_from_employee_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `development_plans` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `review_id` CHAR(36) NULL,
    `items` JSON NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `development_plans_tenant_id_employee_id_idx`(`tenant_id`, `employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `work_locations` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `type` ENUM('OFFICE', 'WFH', 'HYBRID', 'REMOTE', 'CLIENT_SITE', 'TRAVEL', 'CUSTOM') NOT NULL,
    `branch_id` CHAR(36) NULL,
    `requires_approval` BOOLEAN NOT NULL DEFAULT false,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `work_locations_tenant_id_id_key`(`tenant_id`, `id`),
    UNIQUE INDEX `work_locations_tenant_id_name_key`(`tenant_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `work_policies` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `applies_to` ENUM('COMPANY', 'LEGAL_ENTITY', 'BRANCH', 'DEPARTMENT', 'TEAM', 'EMPLOYEE') NOT NULL,
    `target_id` CHAR(36) NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `wfh_allowed` BOOLEAN NOT NULL DEFAULT true,
    `wfh_requires_approval` BOOLEAN NOT NULL DEFAULT true,
    `wfh_max_days_per_month` INTEGER NULL,
    `allowed_start_min` INTEGER NOT NULL DEFAULT 0,
    `allowed_end_min` INTEGER NOT NULL DEFAULT 1440,
    `heartbeat_timeout_sec` INTEGER NOT NULL DEFAULT 180,
    `idle_threshold_sec` INTEGER NOT NULL DEFAULT 300,
    `idle_counting` ENUM('NOT_COUNTED', 'COUNTED', 'COUNTED_UNTIL_THRESHOLD') NOT NULL DEFAULT 'COUNTED_UNTIL_THRESHOLD',
    `max_break_minutes` INTEGER NULL,
    `resume_window_min` INTEGER NOT NULL DEFAULT 120,
    `timesheet_required` BOOLEAN NOT NULL DEFAULT false,
    `daily_report_required` BOOLEAN NOT NULL DEFAULT false,
    `effective_from` DATE NOT NULL,
    `effective_to` DATE NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `work_policies_tenant_id_applies_to_target_id_effective_from_idx`(`tenant_id`, `applies_to`, `target_id`, `effective_from`),
    UNIQUE INDEX `work_policies_tenant_id_id_key`(`tenant_id`, `id`),
    UNIQUE INDEX `work_policies_tenant_id_name_version_key`(`tenant_id`, `name`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wfh_requests` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `work_location_id` CHAR(36) NOT NULL,
    `from_date` DATE NOT NULL,
    `to_date` DATE NOT NULL,
    `recurrence` JSON NULL,
    `reason` TEXT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `wfh_requests_tenant_id_employee_id_from_date_idx`(`tenant_id`, `employee_id`, `from_date`),
    INDEX `wfh_requests_tenant_id_status_idx`(`tenant_id`, `status`),
    UNIQUE INDEX `wfh_requests_tenant_id_id_key`(`tenant_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `work_sessions` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `work_date` DATE NOT NULL,
    `work_location_id` CHAR(36) NOT NULL,
    `policy_id` CHAR(36) NOT NULL,
    `policy_version` INTEGER NOT NULL,
    `wfh_request_id` CHAR(36) NULL,
    `started_at` DATETIME(3) NOT NULL,
    `ended_at` DATETIME(3) NULL,
    `status` ENUM('ACTIVE', 'ON_BREAK', 'DISCONNECTED', 'ENDED', 'AUTO_CLOSED') NOT NULL DEFAULT 'ACTIVE',
    `worked_sec` INTEGER NOT NULL DEFAULT 0,
    `break_sec` INTEGER NOT NULL DEFAULT 0,
    `idle_sec` INTEGER NOT NULL DEFAULT 0,
    `disconnected_sec` INTEGER NOT NULL DEFAULT 0,
    `last_heartbeat_at` DATETIME(3) NULL,
    `needs_review` BOOLEAN NOT NULL DEFAULT false,
    `close_reason` VARCHAR(40) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `work_sessions_tenant_id_employee_id_work_date_idx`(`tenant_id`, `employee_id`, `work_date`),
    INDEX `work_sessions_tenant_id_status_work_date_idx`(`tenant_id`, `status`, `work_date`),
    UNIQUE INDEX `work_sessions_tenant_id_id_key`(`tenant_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_active_sessions` (
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `started_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `employee_active_sessions_tenant_id_session_id_key`(`tenant_id`, `session_id`),
    PRIMARY KEY (`tenant_id`, `employee_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `work_session_events` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `type` ENUM('START', 'HEARTBEAT', 'BREAK_START', 'BREAK_END', 'IDLE_START', 'IDLE_END', 'DISCONNECTED', 'RECONNECTED', 'DEVICE_ATTACHED', 'DEVICE_DETACHED', 'MONITORING_PAUSED', 'MONITORING_RESUMED', 'END', 'AUTO_CLOSED', 'CORRECTION_APPLIED') NOT NULL,
    `server_ts` DATETIME(3) NOT NULL,
    `client_ts` DATETIME(3) NULL,
    `source` ENUM('WEB', 'DESKTOP_AGENT', 'SYSTEM', 'ADMIN') NOT NULL,
    `device_id` CHAR(36) NULL,
    `idempotency_key` VARCHAR(80) NULL,
    `meta` JSON NULL,

    INDEX `work_session_events_tenant_id_session_id_server_ts_idx`(`tenant_id`, `session_id`, `server_ts`),
    UNIQUE INDEX `work_session_events_tenant_id_session_id_idempotency_key_key`(`tenant_id`, `session_id`, `idempotency_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `work_breaks` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `type` ENUM('REGULAR', 'MEAL', 'PERSONAL') NOT NULL DEFAULT 'REGULAR',
    `started_at` DATETIME(3) NOT NULL,
    `ended_at` DATETIME(3) NULL,
    `duration_sec` INTEGER NULL,

    INDEX `work_breaks_tenant_id_session_id_idx`(`tenant_id`, `session_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `idle_records` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `idle_start` DATETIME(3) NOT NULL,
    `idle_end` DATETIME(3) NULL,
    `duration_sec` INTEGER NULL,
    `resolution` ENUM('UNREVIEWED', 'NOT_COUNTED', 'COUNTED_BY_POLICY', 'CORRECTED') NOT NULL DEFAULT 'UNREVIEWED',
    `note` VARCHAR(255) NULL,

    INDEX `idle_records_tenant_id_session_id_idx`(`tenant_id`, `session_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `work_activity_summaries` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `work_date` DATE NOT NULL,
    `active_sec` INTEGER NOT NULL,
    `idle_sec` INTEGER NOT NULL,
    `by_category` JSON NOT NULL,
    `computed_at` DATETIME(3) NOT NULL,

    INDEX `work_activity_summaries_tenant_id_employee_id_work_date_idx`(`tenant_id`, `employee_id`, `work_date`),
    UNIQUE INDEX `work_activity_summaries_tenant_id_session_id_key`(`tenant_id`, `session_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `work_corrections` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `kind` ENUM('ADD_WORK_TIME', 'REMOVE_WORK_TIME', 'MARK_BREAK', 'MISSING_CHECKOUT', 'IDLE_DISPUTE', 'DISCONNECT_DISPUTE') NOT NULL,
    `from_ts` DATETIME(3) NOT NULL,
    `to_ts` DATETIME(3) NOT NULL,
    `reason` TEXT NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `decided_by` CHAR(36) NULL,
    `decided_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `work_corrections_tenant_id_employee_id_status_idx`(`tenant_id`, `employee_id`, `status`),
    UNIQUE INDEX `work_corrections_tenant_id_id_key`(`tenant_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `monitoring_activations` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `version` INTEGER NOT NULL,
    `status` ENUM('DRAFT', 'ACTIVE', 'SUPERSEDED', 'PAUSED') NOT NULL DEFAULT 'DRAFT',
    `purpose` TEXT NOT NULL,
    `scope` JSON NOT NULL,
    `jurisdiction_steps` JSON NOT NULL,
    `lawful_basis` JSON NOT NULL,
    `dpia_key` VARCHAR(500) NULL,
    `notice_text` TEXT NOT NULL,
    `notice_locales` JSON NOT NULL,
    `notice_starts_on` DATE NOT NULL,
    `viewer_role_ids` JSON NOT NULL,
    `retention_days` INTEGER NOT NULL,
    `contacts` JSON NOT NULL,
    `review_due_on` DATE NOT NULL,
    `completed_by` CHAR(36) NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `monitoring_activations_tenant_id_id_key`(`tenant_id`, `id`),
    UNIQUE INDEX `monitoring_activations_tenant_id_version_key`(`tenant_id`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `screenshot_policies` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `activation_id` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `applies_to` ENUM('COMPANY', 'LEGAL_ENTITY', 'BRANCH', 'DEPARTMENT', 'TEAM', 'EMPLOYEE') NOT NULL,
    `target_id` CHAR(36) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `interval_min` INTEGER NOT NULL DEFAULT 10,
    `jitter_pct` INTEGER NOT NULL DEFAULT 20,
    `capture_mode` ENUM('FULL_SCREEN', 'ACTIVE_WINDOW', 'BLURRED') NOT NULL DEFAULT 'FULL_SCREEN',
    `retention_days` INTEGER NOT NULL DEFAULT 30,
    `excluded_apps` JSON NOT NULL,
    `blur_zones` JSON NULL,
    `employee_can_delete` BOOLEAN NOT NULL DEFAULT false,
    `activity_tracking_enabled` BOOLEAN NOT NULL DEFAULT false,
    `effective_from` DATE NOT NULL,
    `effective_to` DATE NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `screenshot_policies_tenant_id_id_key`(`tenant_id`, `id`),
    UNIQUE INDEX `screenshot_policies_tenant_id_name_version_key`(`tenant_id`, `name`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `monitoring_acknowledgements` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `activation_id` CHAR(36) NOT NULL,
    `activation_version` INTEGER NOT NULL,
    `locale` VARCHAR(16) NOT NULL,
    `channel` ENUM('WEB', 'DESKTOP_AGENT') NOT NULL,
    `acknowledged_at` DATETIME(3) NOT NULL,
    `ip_address` VARCHAR(45) NULL,

    UNIQUE INDEX `monitoring_acknowledgements_tenant_id_employee_id_activation_key`(`tenant_id`, `employee_id`, `activation_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `monitored_devices` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `ownership` ENUM('COMPANY_MANAGED', 'BYOD') NOT NULL DEFAULT 'COMPANY_MANAGED',
    `os` ENUM('WINDOWS', 'MACOS', 'LINUX') NOT NULL,
    `os_version` VARCHAR(40) NOT NULL,
    `agent_version` VARCHAR(20) NOT NULL,
    `fingerprint_hash` CHAR(64) NOT NULL,
    `hostname_hash` CHAR(64) NULL,
    `status` ENUM('PENDING', 'ACTIVE', 'REVOKED') NOT NULL DEFAULT 'PENDING',
    `approved_by` CHAR(36) NULL,
    `last_seen_at` DATETIME(3) NULL,
    `last_ip` VARCHAR(45) NULL,
    `revoked_at` DATETIME(3) NULL,
    `revoked_reason` VARCHAR(120) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `monitored_devices_tenant_id_employee_id_idx`(`tenant_id`, `employee_id`),
    UNIQUE INDEX `monitored_devices_tenant_id_id_key`(`tenant_id`, `id`),
    UNIQUE INDEX `monitored_devices_tenant_id_fingerprint_hash_key`(`tenant_id`, `fingerprint_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `device_pairing_codes` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `code_hash` CHAR(64) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `expires_at` DATETIME(3) NOT NULL,
    `used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `device_pairing_codes_code_hash_idx`(`code_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `device_sessions` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `device_id` CHAR(36) NOT NULL,
    `refresh_hash` CHAR(64) NOT NULL,
    `family_id` CHAR(36) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `rotated_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `device_sessions_refresh_hash_key`(`refresh_hash`),
    INDEX `device_sessions_tenant_id_device_id_idx`(`tenant_id`, `device_id`),
    INDEX `device_sessions_family_id_idx`(`family_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `screenshot_records` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `device_id` CHAR(36) NOT NULL,
    `policy_id` CHAR(36) NOT NULL,
    `policy_version` INTEGER NOT NULL,
    `status` ENUM('SLOT_ISSUED', 'UPLOADED', 'PROCESSING', 'AVAILABLE', 'INVALID', 'UNDER_DISPUTE', 'DELETED') NOT NULL DEFAULT 'SLOT_ISSUED',
    `captured_at_server` DATETIME(3) NOT NULL,
    `captured_at_client` DATETIME(3) NULL,
    `s3_key` VARCHAR(500) NULL,
    `thumb_key` VARCHAR(500) NULL,
    `sha256` CHAR(64) NULL,
    `bytes` INTEGER NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `foreground_category_id` CHAR(36) NULL,
    `retention_until` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `delete_reason` VARCHAR(60) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `screenshot_records_tenant_id_employee_id_captured_at_server_idx`(`tenant_id`, `employee_id`, `captured_at_server`),
    INDEX `screenshot_records_tenant_id_session_id_idx`(`tenant_id`, `session_id`),
    INDEX `screenshot_records_tenant_id_status_retention_until_idx`(`tenant_id`, `status`, `retention_until`),
    UNIQUE INDEX `screenshot_records_tenant_id_id_key`(`tenant_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `screenshot_skips` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `device_id` CHAR(36) NOT NULL,
    `reason` ENUM('EXCLUDED_APP', 'IDLE', 'ON_BREAK', 'SCREEN_LOCKED', 'NO_PERMISSION', 'POLICY_OUTDATED', 'OFFLINE', 'OTHER') NOT NULL,
    `occurred_at` DATETIME(3) NOT NULL,

    INDEX `screenshot_skips_tenant_id_session_id_occurred_at_idx`(`tenant_id`, `session_id`, `occurred_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `screenshot_access_logs` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `screenshot_id` CHAR(36) NOT NULL,
    `actor_user_id` CHAR(36) NOT NULL,
    `action` ENUM('LIST', 'VIEW', 'DOWNLOAD', 'EXPORT', 'DELETE', 'DISPUTE', 'RESTORE') NOT NULL,
    `reason` VARCHAR(255) NULL,
    `ip_address` VARCHAR(45) NULL,
    `user_agent` VARCHAR(255) NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `screenshot_access_logs_tenant_id_screenshot_id_at_idx`(`tenant_id`, `screenshot_id`, `at`),
    INDEX `screenshot_access_logs_tenant_id_actor_user_id_at_idx`(`tenant_id`, `actor_user_id`, `at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `screenshot_disputes` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `screenshot_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `reason` TEXT NOT NULL,
    `status` ENUM('OPEN', 'UNDER_REVIEW', 'RESTORED', 'DELETED', 'TIME_CORRECTED') NOT NULL DEFAULT 'OPEN',
    `reviewer_employee_id` CHAR(36) NULL,
    `resolution` TEXT NULL,
    `resolved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `screenshot_disputes_tenant_id_status_idx`(`tenant_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `privacy_incidents` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `reporter_employee_id` CHAR(36) NOT NULL,
    `screenshot_id` CHAR(36) NULL,
    `description` TEXT NOT NULL,
    `status` ENUM('OPEN', 'INVESTIGATING', 'RESOLVED') NOT NULL DEFAULT 'OPEN',
    `handled_by` CHAR(36) NULL,
    `resolution` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolved_at` DATETIME(3) NULL,

    INDEX `privacy_incidents_tenant_id_status_idx`(`tenant_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `application_categories` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `is_work` BOOLEAN NOT NULL DEFAULT true,
    `color` VARCHAR(9) NULL,

    UNIQUE INDEX `application_categories_tenant_id_id_key`(`tenant_id`, `id`),
    UNIQUE INDEX `application_categories_tenant_id_name_key`(`tenant_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `approved_applications` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `category_id` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `kind` ENUM('DESKTOP_APP', 'WEB_DOMAIN') NOT NULL,
    `platform_identifiers` JSON NOT NULL,
    `is_excluded` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `approved_applications_tenant_id_id_key`(`tenant_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `application_usage_records` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `approved_app_id` CHAR(36) NOT NULL,
    `bucket_start` DATETIME(3) NOT NULL,
    `active_sec` INTEGER NOT NULL,

    UNIQUE INDEX `application_usage_records_tenant_id_session_id_approved_app__key`(`tenant_id`, `session_id`, `approved_app_id`, `bucket_start`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `projects` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `description` TEXT NULL,
    `client_name` VARCHAR(150) NULL,
    `status` ENUM('PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
    `is_billable` BOOLEAN NOT NULL DEFAULT false,
    `owner_employee_id` CHAR(36) NULL,
    `start_date` DATE NULL,
    `end_date` DATE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `projects_tenant_id_id_key`(`tenant_id`, `id`),
    UNIQUE INDEX `projects_tenant_id_code_key`(`tenant_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_members` (
    `tenant_id` CHAR(36) NOT NULL,
    `project_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `role` VARCHAR(40) NOT NULL DEFAULT 'MEMBER',

    INDEX `project_members_tenant_id_employee_id_idx`(`tenant_id`, `employee_id`),
    PRIMARY KEY (`project_id`, `employee_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tasks` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `project_id` CHAR(36) NULL,
    `parent_task_id` CHAR(36) NULL,
    `title` VARCHAR(250) NOT NULL,
    `description` TEXT NULL,
    `priority` ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT') NOT NULL DEFAULT 'MEDIUM',
    `status` ENUM('ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'UNDER_REVIEW', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'ASSIGNED',
    `due_date` DATE NULL,
    `estimate_min` INTEGER NULL,
    `actual_min` INTEGER NOT NULL DEFAULT 0,
    `progress_pct` INTEGER NOT NULL DEFAULT 0,
    `requires_approval` BOOLEAN NOT NULL DEFAULT false,
    `created_by_employee_id` CHAR(36) NULL,
    `approved_by` CHAR(36) NULL,
    `approved_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `tasks_tenant_id_project_id_status_idx`(`tenant_id`, `project_id`, `status`),
    INDEX `tasks_tenant_id_status_due_date_idx`(`tenant_id`, `status`, `due_date`),
    UNIQUE INDEX `tasks_tenant_id_id_key`(`tenant_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_assignments` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `task_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `assigned_by` CHAR(36) NULL,
    `assigned_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `unassigned_at` DATETIME(3) NULL,

    INDEX `task_assignments_tenant_id_employee_id_idx`(`tenant_id`, `employee_id`),
    UNIQUE INDEX `task_assignments_tenant_id_task_id_employee_id_key`(`tenant_id`, `task_id`, `employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_comments` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `task_id` CHAR(36) NOT NULL,
    `author_employee_id` CHAR(36) NOT NULL,
    `body` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `edited_at` DATETIME(3) NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `task_comments_tenant_id_task_id_idx`(`tenant_id`, `task_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_attachments` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `task_id` CHAR(36) NOT NULL,
    `uploaded_by_employee_id` CHAR(36) NOT NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `s3_key` VARCHAR(500) NOT NULL,
    `mime_type` VARCHAR(100) NOT NULL,
    `size_bytes` INTEGER NOT NULL,
    `scan_status` ENUM('PENDING', 'CLEAN', 'INFECTED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `task_attachments_tenant_id_task_id_idx`(`tenant_id`, `task_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_time_entries` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `task_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NULL,
    `started_at` DATETIME(3) NOT NULL,
    `ended_at` DATETIME(3) NULL,
    `duration_sec` INTEGER NULL,
    `source` ENUM('TIMER', 'MANUAL', 'CORRECTION') NOT NULL DEFAULT 'TIMER',
    `note` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `task_time_entries_tenant_id_employee_id_started_at_idx`(`tenant_id`, `employee_id`, `started_at`),
    INDEX `task_time_entries_tenant_id_task_id_idx`(`tenant_id`, `task_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `daily_work_reports` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `work_date` DATE NOT NULL,
    `timesheet_id` CHAR(36) NULL,
    `summary_snapshot` JSON NOT NULL,
    `notes` TEXT NULL,
    `status` ENUM('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED') NOT NULL DEFAULT 'DRAFT',
    `submitted_at` DATETIME(3) NULL,
    `reviewed_by` CHAR(36) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `review_comment` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `daily_work_reports_tenant_id_status_work_date_idx`(`tenant_id`, `status`, `work_date`),
    UNIQUE INDEX `daily_work_reports_tenant_id_id_key`(`tenant_id`, `id`),
    UNIQUE INDEX `daily_work_reports_tenant_id_employee_id_work_date_key`(`tenant_id`, `employee_id`, `work_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `timesheet_approvals` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `employee_id` CHAR(36) NOT NULL,
    `week_start` DATE NOT NULL,
    `total_sec` INTEGER NOT NULL,
    `breakdown` JSON NOT NULL,
    `status` ENUM('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED') NOT NULL DEFAULT 'DRAFT',
    `submitted_at` DATETIME(3) NULL,
    `approver_employee_id` CHAR(36) NULL,
    `decided_at` DATETIME(3) NULL,
    `comment` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `timesheet_approvals_tenant_id_approver_employee_id_status_idx`(`tenant_id`, `approver_employee_id`, `status`),
    UNIQUE INDEX `timesheet_approvals_tenant_id_id_key`(`tenant_id`, `id`),
    UNIQUE INDEX `timesheet_approvals_tenant_id_employee_id_week_start_key`(`tenant_id`, `employee_id`, `week_start`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `platform_admins` ADD CONSTRAINT `platform_admins_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `mfa_factors` ADD CONSTRAINT `mfa_factors_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `recovery_codes` ADD CONSTRAINT `recovery_codes_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `auth_tokens` ADD CONSTRAINT `auth_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `plan_prices` ADD CONSTRAINT `plan_prices_plan_id_fkey` FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `statutory_rule_packs` ADD CONSTRAINT `statutory_rule_packs_country_code_fkey` FOREIGN KEY (`country_code`) REFERENCES `country_profiles`(`code`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `statutory_rule_versions` ADD CONSTRAINT `statutory_rule_versions_pack_id_fkey` FOREIGN KEY (`pack_id`) REFERENCES `statutory_rule_packs`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `jurisdiction_policies` ADD CONSTRAINT `jurisdiction_policies_country_code_fkey` FOREIGN KEY (`country_code`) REFERENCES `country_profiles`(`code`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `tenants` ADD CONSTRAINT `tenants_plan_id_fkey` FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `tenant_memberships` ADD CONSTRAINT `tenant_memberships_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `tenant_memberships` ADD CONSTRAINT `tenant_memberships_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `tenant_memberships` ADD CONSTRAINT `tenant_memberships_tenant_id_employee_id_fkey` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `roles` ADD CONSTRAINT `roles_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_tenant_id_role_id_fkey` FOREIGN KEY (`tenant_id`, `role_id`) REFERENCES `roles`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permission_code_fkey` FOREIGN KEY (`permission_code`) REFERENCES `permissions`(`code`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `membership_roles` ADD CONSTRAINT `membership_roles_tenant_id_membership_id_fkey` FOREIGN KEY (`tenant_id`, `membership_id`) REFERENCES `tenant_memberships`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `membership_roles` ADD CONSTRAINT `membership_roles_tenant_id_role_id_fkey` FOREIGN KEY (`tenant_id`, `role_id`) REFERENCES `roles`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `break_glass_grants` ADD CONSTRAINT `break_glass_grants_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `break_glass_grants` ADD CONSTRAINT `break_glass_grants_platform_admin_id_fkey` FOREIGN KEY (`platform_admin_id`) REFERENCES `platform_admins`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_plan_id_fkey` FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_tenant_id_subscription_id_fkey` FOREIGN KEY (`tenant_id`, `subscription_id`) REFERENCES `subscriptions`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `usage_snapshots` ADD CONSTRAINT `usage_snapshots_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `legal_entities` ADD CONSTRAINT `legal_entities_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `legal_entities` ADD CONSTRAINT `legal_entities_country_code_fkey` FOREIGN KEY (`country_code`) REFERENCES `country_profiles`(`code`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `branches` ADD CONSTRAINT `branches_tenant_id_legal_entity_id_fkey` FOREIGN KEY (`tenant_id`, `legal_entity_id`) REFERENCES `legal_entities`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `branches` ADD CONSTRAINT `branches_tenant_id_holiday_calendar_id_fkey` FOREIGN KEY (`tenant_id`, `holiday_calendar_id`) REFERENCES `holiday_calendars`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `departments` ADD CONSTRAINT `departments_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `departments` ADD CONSTRAINT `departments_tenant_id_parent_id_fkey` FOREIGN KEY (`tenant_id`, `parent_id`) REFERENCES `departments`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `designations` ADD CONSTRAINT `designations_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `teams` ADD CONSTRAINT `teams_tenant_id_department_id_fkey` FOREIGN KEY (`tenant_id`, `department_id`) REFERENCES `departments`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `team_members` ADD CONSTRAINT `team_members_tenant_id_team_id_fkey` FOREIGN KEY (`tenant_id`, `team_id`) REFERENCES `teams`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `team_members` ADD CONSTRAINT `team_members_tenant_id_employee_id_fkey` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `work_schedules` ADD CONSTRAINT `work_schedules_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `holiday_calendars` ADD CONSTRAINT `holiday_calendars_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `holidays` ADD CONSTRAINT `holidays_tenant_id_calendar_id_fkey` FOREIGN KEY (`tenant_id`, `calendar_id`) REFERENCES `holiday_calendars`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `company_policies` ADD CONSTRAINT `company_policies_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `policy_acknowledgements` ADD CONSTRAINT `policy_acknowledgements_tenant_id_policy_id_fkey` FOREIGN KEY (`tenant_id`, `policy_id`) REFERENCES `company_policies`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `policy_acknowledgements` ADD CONSTRAINT `policy_acknowledgements_tenant_id_employee_id_fkey` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `announcements` ADD CONSTRAINT `announcements_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_tenant_id_legal_entity_id_fkey` FOREIGN KEY (`tenant_id`, `legal_entity_id`) REFERENCES `legal_entities`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_tenant_id_department_id_fkey` FOREIGN KEY (`tenant_id`, `department_id`) REFERENCES `departments`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_tenant_id_designation_id_fkey` FOREIGN KEY (`tenant_id`, `designation_id`) REFERENCES `designations`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_tenant_id_branch_id_fkey` FOREIGN KEY (`tenant_id`, `branch_id`) REFERENCES `branches`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_tenant_id_manager_id_fkey` FOREIGN KEY (`tenant_id`, `manager_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `employment_records` ADD CONSTRAINT `employment_records_tenant_id_employee_id_fkey` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `employment_records` ADD CONSTRAINT `employment_records_tenant_id_manager_id_fkey` FOREIGN KEY (`tenant_id`, `manager_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `employment_records` ADD CONSTRAINT `employment_records_tenant_id_department_id_fkey` FOREIGN KEY (`tenant_id`, `department_id`) REFERENCES `departments`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `employment_records` ADD CONSTRAINT `employment_records_tenant_id_designation_id_fkey` FOREIGN KEY (`tenant_id`, `designation_id`) REFERENCES `designations`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `employment_records` ADD CONSTRAINT `employment_records_tenant_id_branch_id_fkey` FOREIGN KEY (`tenant_id`, `branch_id`) REFERENCES `branches`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `employment_records` ADD CONSTRAINT `employment_records_tenant_id_schedule_id_fkey` FOREIGN KEY (`tenant_id`, `schedule_id`) REFERENCES `work_schedules`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `employee_hierarchies` ADD CONSTRAINT `employee_hierarchies_tenant_id_ancestor_id_fkey` FOREIGN KEY (`tenant_id`, `ancestor_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `employee_hierarchies` ADD CONSTRAINT `employee_hierarchies_tenant_id_descendant_id_fkey` FOREIGN KEY (`tenant_id`, `descendant_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `employee_documents` ADD CONSTRAINT `employee_documents_tenant_id_employee_id_fkey` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `employee_bank_accounts` ADD CONSTRAINT `employee_bank_accounts_tenant_id_employee_id_fkey` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `emergency_contacts` ADD CONSTRAINT `emergency_contacts_tenant_id_employee_id_fkey` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `bulk_import_jobs` ADD CONSTRAINT `bulk_import_jobs_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `approval_steps` ADD CONSTRAINT `approval_steps_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `data_subject_requests` ADD CONSTRAINT `data_subject_requests_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `data_subject_requests` ADD CONSTRAINT `data_subject_requests_tenant_id_employee_id_fkey` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `helpdesk_tickets` ADD CONSTRAINT `helpdesk_tickets_tenant_id_employee_id_fkey` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `shifts` ADD CONSTRAINT `shifts_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `shift_assignments` ADD CONSTRAINT `shift_assignments_tenant_id_shift_id_fkey` FOREIGN KEY (`tenant_id`, `shift_id`) REFERENCES `shifts`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `shift_assignments` ADD CONSTRAINT `shift_assignments_tenant_id_employee_id_fkey` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `overtime_rules` ADD CONSTRAINT `overtime_rules_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `overtime_rules` ADD CONSTRAINT `overtime_rules_tenant_id_legal_entity_id_fkey` FOREIGN KEY (`tenant_id`, `legal_entity_id`) REFERENCES `legal_entities`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `attendance_punches` ADD CONSTRAINT `attendance_punches_tenant_id_employee_id_fkey` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `attendance_punches` ADD CONSTRAINT `attendance_punches_tenant_id_work_location_id_fkey` FOREIGN KEY (`tenant_id`, `work_location_id`) REFERENCES `work_locations`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `attendance_days` ADD CONSTRAINT `attendance_days_tenant_id_employee_id_fkey` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `attendance_regularizations` ADD CONSTRAINT `attendance_regularizations_tenant_id_employee_id_fkey` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `attendance_regularizations` ADD CONSTRAINT `attendance_regularizations_tenant_id_attendance_day_id_fkey` FOREIGN KEY (`tenant_id`, `attendance_day_id`) REFERENCES `attendance_days`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `leave_types` ADD CONSTRAINT `leave_types_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `leave_policies` ADD CONSTRAINT `leave_policies_tenant_id_leave_type_id_fkey` FOREIGN KEY (`tenant_id`, `leave_type_id`) REFERENCES `leave_types`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `leave_policies` ADD CONSTRAINT `leave_policies_tenant_id_legal_entity_id_fkey` FOREIGN KEY (`tenant_id`, `legal_entity_id`) REFERENCES `legal_entities`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `leave_policy_assignments` ADD CONSTRAINT `leave_policy_assignments_tenant_id_policy_id_fkey` FOREIGN KEY (`tenant_id`, `policy_id`) REFERENCES `leave_policies`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `leave_ledger_entries` ADD CONSTRAINT `leave_ledger_entries_tenant_id_employee_id_fkey` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `leave_ledger_entries` ADD CONSTRAINT `leave_ledger_entries_tenant_id_leave_type_id_fkey` FOREIGN KEY (`tenant_id`, `leave_type_id`) REFERENCES `leave_types`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `leave_requests` ADD CONSTRAINT `leave_requests_tenant_id_employee_id_fkey` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `leave_requests` ADD CONSTRAINT `leave_requests_tenant_id_leave_type_id_fkey` FOREIGN KEY (`tenant_id`, `leave_type_id`) REFERENCES `leave_types`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `leave_request_days` ADD CONSTRAINT `leave_request_days_tenant_id_request_id_fkey` FOREIGN KEY (`tenant_id`, `request_id`) REFERENCES `leave_requests`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `salary_components` ADD CONSTRAINT `salary_components_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `salary_structures` ADD CONSTRAINT `salary_structures_tenant_id_legal_entity_id_fkey` FOREIGN KEY (`tenant_id`, `legal_entity_id`) REFERENCES `legal_entities`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `salary_structure_components` ADD CONSTRAINT `salary_structure_components_tenant_id_structure_id_fkey` FOREIGN KEY (`tenant_id`, `structure_id`) REFERENCES `salary_structures`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `salary_structure_components` ADD CONSTRAINT `salary_structure_components_tenant_id_component_id_fkey` FOREIGN KEY (`tenant_id`, `component_id`) REFERENCES `salary_components`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `employee_salaries` ADD CONSTRAINT `employee_salaries_tenant_id_employee_id_fkey` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `employee_salaries` ADD CONSTRAINT `employee_salaries_tenant_id_structure_id_fkey` FOREIGN KEY (`tenant_id`, `structure_id`) REFERENCES `salary_structures`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `employee_salary_lines` ADD CONSTRAINT `employee_salary_lines_tenant_id_employee_salary_id_fkey` FOREIGN KEY (`tenant_id`, `employee_salary_id`) REFERENCES `employee_salaries`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `employee_salary_lines` ADD CONSTRAINT `employee_salary_lines_tenant_id_component_id_fkey` FOREIGN KEY (`tenant_id`, `component_id`) REFERENCES `salary_components`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `tenant_statutory_settings` ADD CONSTRAINT `tenant_statutory_settings_tenant_id_legal_entity_id_fkey` FOREIGN KEY (`tenant_id`, `legal_entity_id`) REFERENCES `legal_entities`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `tenant_statutory_settings` ADD CONSTRAINT `tenant_statutory_settings_pack_id_fkey` FOREIGN KEY (`pack_id`) REFERENCES `statutory_rule_packs`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `payroll_periods` ADD CONSTRAINT `payroll_periods_tenant_id_legal_entity_id_fkey` FOREIGN KEY (`tenant_id`, `legal_entity_id`) REFERENCES `legal_entities`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `payroll_runs` ADD CONSTRAINT `payroll_runs_tenant_id_period_id_fkey` FOREIGN KEY (`tenant_id`, `period_id`) REFERENCES `payroll_periods`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `payroll_run_employees` ADD CONSTRAINT `payroll_run_employees_tenant_id_run_id_fkey` FOREIGN KEY (`tenant_id`, `run_id`) REFERENCES `payroll_runs`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `payroll_run_employees` ADD CONSTRAINT `payroll_run_employees_tenant_id_employee_id_fkey` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `payroll_run_employees` ADD CONSTRAINT `payroll_run_employees_tenant_id_employee_salary_id_fkey` FOREIGN KEY (`tenant_id`, `employee_salary_id`) REFERENCES `employee_salaries`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `payroll_lines` ADD CONSTRAINT `payroll_lines_tenant_id_run_employee_id_fkey` FOREIGN KEY (`tenant_id`, `run_employee_id`) REFERENCES `payroll_run_employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `payroll_lines` ADD CONSTRAINT `payroll_lines_tenant_id_component_id_fkey` FOREIGN KEY (`tenant_id`, `component_id`) REFERENCES `salary_components`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `payroll_inputs` ADD CONSTRAINT `payroll_inputs_tenant_id_run_id_fkey` FOREIGN KEY (`tenant_id`, `run_id`) REFERENCES `payroll_runs`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `payroll_inputs` ADD CONSTRAINT `payroll_inputs_tenant_id_employee_id_fkey` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `payroll_inputs` ADD CONSTRAINT `payroll_inputs_tenant_id_component_id_fkey` FOREIGN KEY (`tenant_id`, `component_id`) REFERENCES `salary_components`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `payslips` ADD CONSTRAINT `payslips_tenant_id_run_employee_id_fkey` FOREIGN KEY (`tenant_id`, `run_employee_id`) REFERENCES `payroll_run_employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `tax_declarations` ADD CONSTRAINT `tax_declarations_tenant_id_employee_id_fkey` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `fnf_settlements` ADD CONSTRAINT `fnf_settlements_tenant_id_employee_id_fkey` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `fnf_settlements` ADD CONSTRAINT `fnf_settlements_tenant_id_run_id_fkey` FOREIGN KEY (`tenant_id`, `run_id`) REFERENCES `payroll_runs`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `job_requisitions` ADD CONSTRAINT `job_requisitions_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `job_requisitions` ADD CONSTRAINT `job_requisitions_tenant_id_department_id_fkey` FOREIGN KEY (`tenant_id`, `department_id`) REFERENCES `departments`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `job_requisitions` ADD CONSTRAINT `job_requisitions_tenant_id_designation_id_fkey` FOREIGN KEY (`tenant_id`, `designation_id`) REFERENCES `designations`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `job_postings` ADD CONSTRAINT `job_postings_tenant_id_requisition_id_fkey` FOREIGN KEY (`tenant_id`, `requisition_id`) REFERENCES `job_requisitions`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `candidates` ADD CONSTRAINT `candidates_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `job_applications` ADD CONSTRAINT `job_applications_tenant_id_posting_id_fkey` FOREIGN KEY (`tenant_id`, `posting_id`) REFERENCES `job_postings`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `job_applications` ADD CONSTRAINT `job_applications_tenant_id_candidate_id_fkey` FOREIGN KEY (`tenant_id`, `candidate_id`) REFERENCES `candidates`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `interviews` ADD CONSTRAINT `interviews_tenant_id_application_id_fkey` FOREIGN KEY (`tenant_id`, `application_id`) REFERENCES `job_applications`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `interview_feedbacks` ADD CONSTRAINT `interview_feedbacks_tenant_id_interview_id_fkey` FOREIGN KEY (`tenant_id`, `interview_id`) REFERENCES `interviews`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `interview_feedbacks` ADD CONSTRAINT `interview_feedbacks_tenant_id_interviewer_employee_id_fkey` FOREIGN KEY (`tenant_id`, `interviewer_employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `offers` ADD CONSTRAINT `offers_tenant_id_application_id_fkey` FOREIGN KEY (`tenant_id`, `application_id`) REFERENCES `job_applications`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `onboarding_templates` ADD CONSTRAINT `onboarding_templates_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `onboarding_template_tasks` ADD CONSTRAINT `onboarding_template_tasks_tenant_id_template_id_fkey` FOREIGN KEY (`tenant_id`, `template_id`) REFERENCES `onboarding_templates`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `onboarding_cases` ADD CONSTRAINT `onboarding_cases_tenant_id_employee_id_fkey` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `onboarding_cases` ADD CONSTRAINT `onboarding_cases_tenant_id_offer_id_fkey` FOREIGN KEY (`tenant_id`, `offer_id`) REFERENCES `offers`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `onboarding_cases` ADD CONSTRAINT `onboarding_cases_tenant_id_template_id_fkey` FOREIGN KEY (`tenant_id`, `template_id`) REFERENCES `onboarding_templates`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `onboarding_tasks` ADD CONSTRAINT `onboarding_tasks_tenant_id_case_id_fkey` FOREIGN KEY (`tenant_id`, `case_id`) REFERENCES `onboarding_cases`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `onboarding_documents` ADD CONSTRAINT `onboarding_documents_tenant_id_case_id_fkey` FOREIGN KEY (`tenant_id`, `case_id`) REFERENCES `onboarding_cases`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `assets` ADD CONSTRAINT `assets_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `assets` ADD CONSTRAINT `assets_tenant_id_assigned_employee_id_fkey` FOREIGN KEY (`tenant_id`, `assigned_employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `performance_cycles` ADD CONSTRAINT `performance_cycles_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `goals` ADD CONSTRAINT `goals_tenant_id_cycle_id_fkey` FOREIGN KEY (`tenant_id`, `cycle_id`) REFERENCES `performance_cycles`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `goals` ADD CONSTRAINT `goals_tenant_id_employee_id_fkey` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `goals` ADD CONSTRAINT `goals_tenant_id_parent_goal_id_fkey` FOREIGN KEY (`tenant_id`, `parent_goal_id`) REFERENCES `goals`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `performance_reviews` ADD CONSTRAINT `performance_reviews_tenant_id_cycle_id_fkey` FOREIGN KEY (`tenant_id`, `cycle_id`) REFERENCES `performance_cycles`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `performance_reviews` ADD CONSTRAINT `performance_reviews_tenant_id_employee_id_fkey` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `performance_reviews` ADD CONSTRAINT `performance_reviews_tenant_id_reviewer_employee_id_fkey` FOREIGN KEY (`tenant_id`, `reviewer_employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `review_responses` ADD CONSTRAINT `review_responses_tenant_id_review_id_fkey` FOREIGN KEY (`tenant_id`, `review_id`) REFERENCES `performance_reviews`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `feedback_requests` ADD CONSTRAINT `feedback_requests_tenant_id_review_id_fkey` FOREIGN KEY (`tenant_id`, `review_id`) REFERENCES `performance_reviews`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `development_plans` ADD CONSTRAINT `development_plans_tenant_id_employee_id_fkey` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `development_plans` ADD CONSTRAINT `development_plans_tenant_id_review_id_fkey` FOREIGN KEY (`tenant_id`, `review_id`) REFERENCES `performance_reviews`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `work_locations` ADD CONSTRAINT `work_locations_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `work_locations` ADD CONSTRAINT `work_locations_tenant_id_branch_id_fkey` FOREIGN KEY (`tenant_id`, `branch_id`) REFERENCES `branches`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `work_policies` ADD CONSTRAINT `work_policies_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `wfh_requests` ADD CONSTRAINT `wfh_requests_tenant_id_employee_id_fkey` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `wfh_requests` ADD CONSTRAINT `wfh_requests_tenant_id_work_location_id_fkey` FOREIGN KEY (`tenant_id`, `work_location_id`) REFERENCES `work_locations`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `work_sessions` ADD CONSTRAINT `work_sessions_tenant_id_employee_id_fkey` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `work_sessions` ADD CONSTRAINT `work_sessions_tenant_id_work_location_id_fkey` FOREIGN KEY (`tenant_id`, `work_location_id`) REFERENCES `work_locations`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `work_sessions` ADD CONSTRAINT `work_sessions_tenant_id_policy_id_fkey` FOREIGN KEY (`tenant_id`, `policy_id`) REFERENCES `work_policies`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `work_sessions` ADD CONSTRAINT `work_sessions_tenant_id_wfh_request_id_fkey` FOREIGN KEY (`tenant_id`, `wfh_request_id`) REFERENCES `wfh_requests`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `employee_active_sessions` ADD CONSTRAINT `employee_active_sessions_tenant_id_employee_id_fkey` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `employee_active_sessions` ADD CONSTRAINT `employee_active_sessions_tenant_id_session_id_fkey` FOREIGN KEY (`tenant_id`, `session_id`) REFERENCES `work_sessions`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `work_session_events` ADD CONSTRAINT `work_session_events_tenant_id_session_id_fkey` FOREIGN KEY (`tenant_id`, `session_id`) REFERENCES `work_sessions`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `work_breaks` ADD CONSTRAINT `work_breaks_tenant_id_session_id_fkey` FOREIGN KEY (`tenant_id`, `session_id`) REFERENCES `work_sessions`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `idle_records` ADD CONSTRAINT `idle_records_tenant_id_session_id_fkey` FOREIGN KEY (`tenant_id`, `session_id`) REFERENCES `work_sessions`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `work_activity_summaries` ADD CONSTRAINT `work_activity_summaries_tenant_id_session_id_fkey` FOREIGN KEY (`tenant_id`, `session_id`) REFERENCES `work_sessions`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `work_activity_summaries` ADD CONSTRAINT `work_activity_summaries_tenant_id_employee_id_fkey` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `work_corrections` ADD CONSTRAINT `work_corrections_tenant_id_session_id_fkey` FOREIGN KEY (`tenant_id`, `session_id`) REFERENCES `work_sessions`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `work_corrections` ADD CONSTRAINT `work_corrections_tenant_id_employee_id_fkey` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `monitoring_activations` ADD CONSTRAINT `monitoring_activations_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `screenshot_policies` ADD CONSTRAINT `screenshot_policies_tenant_id_activation_id_fkey` FOREIGN KEY (`tenant_id`, `activation_id`) REFERENCES `monitoring_activations`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `monitoring_acknowledgements` ADD CONSTRAINT `monitoring_acknowledgements_tenant_id_employee_id_fkey` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `monitoring_acknowledgements` ADD CONSTRAINT `monitoring_acknowledgements_tenant_id_activation_id_fkey` FOREIGN KEY (`tenant_id`, `activation_id`) REFERENCES `monitoring_activations`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `monitored_devices` ADD CONSTRAINT `monitored_devices_tenant_id_employee_id_fkey` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `device_pairing_codes` ADD CONSTRAINT `device_pairing_codes_tenant_id_employee_id_fkey` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `device_sessions` ADD CONSTRAINT `device_sessions_tenant_id_device_id_fkey` FOREIGN KEY (`tenant_id`, `device_id`) REFERENCES `monitored_devices`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `screenshot_records` ADD CONSTRAINT `screenshot_records_tenant_id_employee_id_fkey` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `screenshot_records` ADD CONSTRAINT `screenshot_records_tenant_id_session_id_fkey` FOREIGN KEY (`tenant_id`, `session_id`) REFERENCES `work_sessions`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `screenshot_records` ADD CONSTRAINT `screenshot_records_tenant_id_device_id_fkey` FOREIGN KEY (`tenant_id`, `device_id`) REFERENCES `monitored_devices`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `screenshot_records` ADD CONSTRAINT `screenshot_records_tenant_id_policy_id_fkey` FOREIGN KEY (`tenant_id`, `policy_id`) REFERENCES `screenshot_policies`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `screenshot_records` ADD CONSTRAINT `screenshot_records_tenant_id_foreground_category_id_fkey` FOREIGN KEY (`tenant_id`, `foreground_category_id`) REFERENCES `application_categories`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `screenshot_skips` ADD CONSTRAINT `screenshot_skips_tenant_id_session_id_fkey` FOREIGN KEY (`tenant_id`, `session_id`) REFERENCES `work_sessions`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `screenshot_skips` ADD CONSTRAINT `screenshot_skips_tenant_id_device_id_fkey` FOREIGN KEY (`tenant_id`, `device_id`) REFERENCES `monitored_devices`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `screenshot_access_logs` ADD CONSTRAINT `screenshot_access_logs_tenant_id_screenshot_id_fkey` FOREIGN KEY (`tenant_id`, `screenshot_id`) REFERENCES `screenshot_records`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `screenshot_disputes` ADD CONSTRAINT `screenshot_disputes_tenant_id_screenshot_id_fkey` FOREIGN KEY (`tenant_id`, `screenshot_id`) REFERENCES `screenshot_records`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `screenshot_disputes` ADD CONSTRAINT `screenshot_disputes_tenant_id_employee_id_fkey` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `privacy_incidents` ADD CONSTRAINT `privacy_incidents_tenant_id_reporter_employee_id_fkey` FOREIGN KEY (`tenant_id`, `reporter_employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `privacy_incidents` ADD CONSTRAINT `privacy_incidents_tenant_id_screenshot_id_fkey` FOREIGN KEY (`tenant_id`, `screenshot_id`) REFERENCES `screenshot_records`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `application_categories` ADD CONSTRAINT `application_categories_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `approved_applications` ADD CONSTRAINT `approved_applications_tenant_id_category_id_fkey` FOREIGN KEY (`tenant_id`, `category_id`) REFERENCES `application_categories`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `application_usage_records` ADD CONSTRAINT `application_usage_records_tenant_id_session_id_fkey` FOREIGN KEY (`tenant_id`, `session_id`) REFERENCES `work_sessions`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `application_usage_records` ADD CONSTRAINT `application_usage_records_tenant_id_approved_app_id_fkey` FOREIGN KEY (`tenant_id`, `approved_app_id`) REFERENCES `approved_applications`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `projects` ADD CONSTRAINT `projects_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `project_members` ADD CONSTRAINT `project_members_tenant_id_project_id_fkey` FOREIGN KEY (`tenant_id`, `project_id`) REFERENCES `projects`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `project_members` ADD CONSTRAINT `project_members_tenant_id_employee_id_fkey` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_tenant_id_project_id_fkey` FOREIGN KEY (`tenant_id`, `project_id`) REFERENCES `projects`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_tenant_id_parent_task_id_fkey` FOREIGN KEY (`tenant_id`, `parent_task_id`) REFERENCES `tasks`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `task_assignments` ADD CONSTRAINT `task_assignments_tenant_id_task_id_fkey` FOREIGN KEY (`tenant_id`, `task_id`) REFERENCES `tasks`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `task_assignments` ADD CONSTRAINT `task_assignments_tenant_id_employee_id_fkey` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `task_comments` ADD CONSTRAINT `task_comments_tenant_id_task_id_fkey` FOREIGN KEY (`tenant_id`, `task_id`) REFERENCES `tasks`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `task_comments` ADD CONSTRAINT `task_comments_tenant_id_author_employee_id_fkey` FOREIGN KEY (`tenant_id`, `author_employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `task_attachments` ADD CONSTRAINT `task_attachments_tenant_id_task_id_fkey` FOREIGN KEY (`tenant_id`, `task_id`) REFERENCES `tasks`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `task_attachments` ADD CONSTRAINT `task_attachments_tenant_id_uploaded_by_employee_id_fkey` FOREIGN KEY (`tenant_id`, `uploaded_by_employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `task_time_entries` ADD CONSTRAINT `task_time_entries_tenant_id_task_id_fkey` FOREIGN KEY (`tenant_id`, `task_id`) REFERENCES `tasks`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `task_time_entries` ADD CONSTRAINT `task_time_entries_tenant_id_employee_id_fkey` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `task_time_entries` ADD CONSTRAINT `task_time_entries_tenant_id_session_id_fkey` FOREIGN KEY (`tenant_id`, `session_id`) REFERENCES `work_sessions`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `daily_work_reports` ADD CONSTRAINT `daily_work_reports_tenant_id_employee_id_fkey` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `daily_work_reports` ADD CONSTRAINT `daily_work_reports_tenant_id_timesheet_id_fkey` FOREIGN KEY (`tenant_id`, `timesheet_id`) REFERENCES `timesheet_approvals`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `timesheet_approvals` ADD CONSTRAINT `timesheet_approvals_tenant_id_employee_id_fkey` FOREIGN KEY (`tenant_id`, `employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `timesheet_approvals` ADD CONSTRAINT `timesheet_approvals_tenant_id_approver_employee_id_fkey` FOREIGN KEY (`tenant_id`, `approver_employee_id`) REFERENCES `employees`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Immutability guards that Prisma cannot express. Applied in the first migration after the generated DDL.
-- Error code 45000 with a stable message prefix "IMMUTABLE:" so the API can map it to 409.

-- 1. Append-only logs ---------------------------------------------------------
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE: audit_logs is append-only';
CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE: audit_logs is append-only';

CREATE TRIGGER work_session_events_no_update BEFORE UPDATE ON work_session_events FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE: work_session_events is append-only';
CREATE TRIGGER work_session_events_no_delete BEFORE DELETE ON work_session_events FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE: work_session_events is append-only';

CREATE TRIGGER screenshot_access_logs_no_update BEFORE UPDATE ON screenshot_access_logs FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE: screenshot_access_logs is append-only';
CREATE TRIGGER screenshot_access_logs_no_delete BEFORE DELETE ON screenshot_access_logs FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE: screenshot_access_logs is append-only';

-- 2. Finalized payroll ---------------------------------------------------------
-- A FINALIZED run may only move to PAID (setting paid_at). A PAID run cannot change at all.
CREATE TRIGGER payroll_runs_freeze BEFORE UPDATE ON payroll_runs FOR EACH ROW
BEGIN
  IF OLD.status = 'PAID' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE: payroll run is paid';
  END IF;
  IF OLD.status = 'FINALIZED' AND (
       NEW.status <> 'PAID'
       OR NOT (NEW.final_hash <=> OLD.final_hash)
       OR NOT (NEW.totals <=> OLD.totals)
       OR NOT (NEW.rule_versions_pinned <=> OLD.rule_versions_pinned)
       OR NOT (NEW.currency <=> OLD.currency)
       OR NOT (NEW.period_id <=> OLD.period_id)
       OR NOT (NEW.finalized_at <=> OLD.finalized_at)
       OR NOT (NEW.approved_by <=> OLD.approved_by)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE: payroll run is finalized; only FINALIZED -> PAID is allowed';
  END IF;
END;

CREATE TRIGGER payroll_runs_no_delete BEFORE DELETE ON payroll_runs FOR EACH ROW
BEGIN
  IF OLD.status IN ('FINALIZED', 'PAID') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE: finalized payroll run cannot be deleted';
  END IF;
END;

CREATE TRIGGER payroll_run_employees_freeze_ins BEFORE INSERT ON payroll_run_employees FOR EACH ROW
BEGIN
  IF (SELECT status FROM payroll_runs WHERE tenant_id = NEW.tenant_id AND id = NEW.run_id) IN ('FINALIZED', 'PAID') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE: payroll run is finalized';
  END IF;
END;
CREATE TRIGGER payroll_run_employees_freeze_upd BEFORE UPDATE ON payroll_run_employees FOR EACH ROW
BEGIN
  IF (SELECT status FROM payroll_runs WHERE tenant_id = OLD.tenant_id AND id = OLD.run_id) IN ('FINALIZED', 'PAID') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE: payroll run is finalized';
  END IF;
END;
CREATE TRIGGER payroll_run_employees_freeze_del BEFORE DELETE ON payroll_run_employees FOR EACH ROW
BEGIN
  IF (SELECT status FROM payroll_runs WHERE tenant_id = OLD.tenant_id AND id = OLD.run_id) IN ('FINALIZED', 'PAID') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE: payroll run is finalized';
  END IF;
END;

CREATE TRIGGER payroll_lines_freeze_ins BEFORE INSERT ON payroll_lines FOR EACH ROW
BEGIN
  IF (SELECT r.status FROM payroll_run_employees e JOIN payroll_runs r ON r.tenant_id = e.tenant_id AND r.id = e.run_id
      WHERE e.tenant_id = NEW.tenant_id AND e.id = NEW.run_employee_id) IN ('FINALIZED', 'PAID') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE: payroll run is finalized';
  END IF;
END;
CREATE TRIGGER payroll_lines_freeze_upd BEFORE UPDATE ON payroll_lines FOR EACH ROW
BEGIN
  IF (SELECT r.status FROM payroll_run_employees e JOIN payroll_runs r ON r.tenant_id = e.tenant_id AND r.id = e.run_id
      WHERE e.tenant_id = OLD.tenant_id AND e.id = OLD.run_employee_id) IN ('FINALIZED', 'PAID') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE: payroll run is finalized';
  END IF;
END;
CREATE TRIGGER payroll_lines_freeze_del BEFORE DELETE ON payroll_lines FOR EACH ROW
BEGIN
  IF (SELECT r.status FROM payroll_run_employees e JOIN payroll_runs r ON r.tenant_id = e.tenant_id AND r.id = e.run_id
      WHERE e.tenant_id = OLD.tenant_id AND e.id = OLD.run_employee_id) IN ('FINALIZED', 'PAID') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE: payroll run is finalized';
  END IF;
END;

-- Payslip files are content-addressed; only publishing may change after creation.
CREATE TRIGGER payslips_freeze BEFORE UPDATE ON payslips FOR EACH ROW
BEGIN
  IF NOT (NEW.s3_key <=> OLD.s3_key) OR NOT (NEW.sha256 <=> OLD.sha256) OR NOT (NEW.run_employee_id <=> OLD.run_employee_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE: payslip content cannot change';
  END IF;
END;
CREATE TRIGGER payslips_no_delete BEFORE DELETE ON payslips FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE: payslips cannot be deleted';
