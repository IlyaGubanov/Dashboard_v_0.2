-- CreateTable
CREATE TABLE `user` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `login` VARCHAR(64) NULL,
    `password_hash` VARCHAR(100) NULL,
    `can_login` BOOLEAN NOT NULL DEFAULT false,
    `must_change_password` BOOLEAN NOT NULL DEFAULT true,
    `global_role` ENUM('ADMIN', 'MANAGEMENT', 'USER') NOT NULL DEFAULT 'USER',
    `full_name` VARCHAR(200) NOT NULL,
    `position` VARCHAR(200) NULL,
    `email` VARCHAR(200) NULL,
    `phone` VARCHAR(50) NULL,
    `organization_id` INTEGER NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `is_example` BOOLEAN NOT NULL DEFAULT false,
    `last_login_at` DATETIME(3) NULL,
    `failed_logins` INTEGER NOT NULL DEFAULT 0,
    `locked_until` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `user_login_key`(`login`),
    INDEX `user_full_name_idx`(`full_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_session` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `ip` VARCHAR(45) NULL,
    `user_agent` VARCHAR(400) NULL,

    UNIQUE INDEX `user_session_token_hash_key`(`token_hash`),
    INDEX `user_session_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `direction_member` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `direction_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `role` ENUM('CURATOR', 'EDITOR', 'VIEWER') NOT NULL,
    `scope` ENUM('ALL', 'SECTIONS', 'SITES') NOT NULL DEFAULT 'ALL',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `direction_member_direction_id_user_id_key`(`direction_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `direction_member_section` (
    `member_id` INTEGER NOT NULL,
    `section_id` INTEGER NOT NULL,

    PRIMARY KEY (`member_id`, `section_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `organization` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `direction_id` INTEGER NOT NULL,
    `name` VARCHAR(300) NOT NULL,
    `kind` ENUM('CONTRACTOR', 'SUBCONTRACTOR', 'DESIGNER', 'SUPPLIER', 'REVIEWER', 'OTHER') NOT NULL DEFAULT 'CONTRACTOR',
    `inn` VARCHAR(12) NULL,
    `note` TEXT NULL,
    `is_example` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `organization_direction_id_name_kind_key`(`direction_id`, `name`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `direction` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `short_name` VARCHAR(60) NOT NULL,
    `description` TEXT NULL,
    `icon` VARCHAR(40) NULL,
    `color` VARCHAR(20) NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `is_readonly` BOOLEAN NOT NULL DEFAULT false,
    `period_kind` ENUM('DAY', 'WEEK', 'REPORT') NOT NULL,
    `plan_weekday` TINYINT NOT NULL DEFAULT 3,
    `progress_method` ENUM('WEIGHTED_BY_COST', 'WEIGHTED_BY_WORK_WEIGHT', 'SHARE_COMPLETED', 'SIMPLE_AVERAGE') NOT NULL,
    `plan_method` ENUM('LINEAR_ITEM_DATES', 'LINEAR_SITE_DATES', 'NONE') NOT NULL,
    `money_source` ENUM('WORK_ITEMS', 'CONTRACTS', 'SITE_LIMIT', 'NONE') NOT NULL DEFAULT 'NONE',
    `money_label` VARCHAR(40) NULL,
    `thr_warn` DECIMAL(6, 2) NOT NULL DEFAULT -2,
    `thr_crit` DECIMAL(6, 2) NOT NULL DEFAULT -10,
    `site_unit` VARCHAR(40) NOT NULL DEFAULT 'объектов',
    `settings` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `direction_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `section` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `direction_id` INTEGER NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `note` VARCHAR(500) NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `is_archived` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `section_direction_id_code_key`(`direction_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `work_group` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `direction_id` INTEGER NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `work_group_direction_id_name_key`(`direction_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `work_type` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `direction_id` INTEGER NOT NULL,
    `group_id` INTEGER NULL,
    `code` VARCHAR(64) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `full_name` VARCHAR(400) NULL,
    `unit` VARCHAR(20) NULL,
    `weight` DECIMAL(8, 5) NULL,
    `plan_start` DATE NULL,
    `plan_end` DATE NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `is_archived` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `work_type_direction_id_code_key`(`direction_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `status_def` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `direction_id` INTEGER NOT NULL,
    `entity` ENUM('SITE', 'WORK_ITEM') NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `short_name` VARCHAR(40) NULL,
    `color` VARCHAR(20) NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `counts_as_done` BOOLEAN NOT NULL DEFAULT false,
    `exclude_from_calc` BOOLEAN NOT NULL DEFAULT false,
    `is_final` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `status_def_direction_id_entity_code_key`(`direction_id`, `entity`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `field_def` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `direction_id` INTEGER NOT NULL,
    `entity` ENUM('SITE', 'WORK_ITEM', 'CONTRACT', 'SITE_REPORT') NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `label` VARCHAR(200) NOT NULL,
    `type` ENUM('TEXT', 'LONGTEXT', 'NUMBER', 'MONEY', 'PERCENT', 'DATE', 'BOOL', 'SELECT', 'MULTISELECT', 'USER', 'ORGANIZATION', 'URL') NOT NULL,
    `options` JSON NULL,
    `unit` VARCHAR(20) NULL,
    `required` BOOLEAN NOT NULL DEFAULT false,
    `group_name` VARCHAR(100) NULL,
    `hint` VARCHAR(400) NULL,
    `show_in_list` BOOLEAN NOT NULL DEFAULT false,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `is_archived` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `field_def_direction_id_entity_code_key`(`direction_id`, `entity`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `site` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `direction_id` INTEGER NOT NULL,
    `section_id` INTEGER NULL,
    `code` VARCHAR(120) NOT NULL,
    `num` INTEGER NULL,
    `name` VARCHAR(1000) NOT NULL,
    `short_name` VARCHAR(200) NULL,
    `address` VARCHAR(500) NULL,
    `okrug` VARCHAR(20) NULL,
    `district` VARCHAR(100) NULL,
    `lat` DECIMAL(9, 6) NULL,
    `lon` DECIMAL(9, 6) NULL,
    `status_id` INTEGER NULL,
    `plan_start` DATE NULL,
    `plan_end` DATE NULL,
    `contractor_id` INTEGER NULL,
    `designer_id` INTEGER NULL,
    `limit_amount` DECIMAL(18, 2) NULL,
    `attrs` JSON NULL,
    `note` TEXT NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `is_archived` BOOLEAN NOT NULL DEFAULT false,
    `is_example` BOOLEAN NOT NULL DEFAULT false,
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_by_id` INTEGER NULL,
    `updated_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `site_direction_id_section_id_idx`(`direction_id`, `section_id`),
    UNIQUE INDEX `site_direction_id_code_key`(`direction_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `site_assignment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `site_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `role` ENUM('CURATOR', 'ENTRY', 'RESPONSIBLE', 'FOREMAN', 'CHIEF_ENGINEER') NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `site_assignment_user_id_idx`(`user_id`),
    UNIQUE INDEX `site_assignment_site_id_user_id_role_key`(`site_id`, `user_id`, `role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `work_item` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `site_id` INTEGER NOT NULL,
    `work_type_id` INTEGER NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `num` INTEGER NULL,
    `label` VARCHAR(300) NULL,
    `unit` VARCHAR(20) NULL,
    `plan_qty` DECIMAL(18, 3) NULL,
    `plan_cost` DECIMAL(18, 2) NULL,
    `plan_start` DATE NULL,
    `plan_end` DATE NULL,
    `responsible_id` INTEGER NULL,
    `contractor_id` INTEGER NULL,
    `contract_id` INTEGER NULL,
    `attrs` JSON NULL,
    `note` TEXT NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `is_archived` BOOLEAN NOT NULL DEFAULT false,
    `is_example` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `work_item_work_type_id_idx`(`work_type_id`),
    UNIQUE INDEX `work_item_site_id_code_key`(`site_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contract` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `site_id` INTEGER NOT NULL,
    `organization_id` INTEGER NULL,
    `number` VARCHAR(100) NULL,
    `signed_at` DATE NULL,
    `end_at` DATE NULL,
    `amount` DECIMAL(18, 2) NULL,
    `advance_amount` DECIMAL(18, 2) NULL,
    `attrs` JSON NULL,
    `note` TEXT NULL,
    `is_example` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `contract_site_id_idx`(`site_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reporting_period` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `direction_id` INTEGER NOT NULL,
    `date` DATE NOT NULL,
    `label` VARCHAR(100) NULL,
    `status` ENUM('OPEN', 'CLOSED', 'LOCKED') NOT NULL DEFAULT 'OPEN',
    `program` VARCHAR(32) NOT NULL DEFAULT '',
    `opened_by_id` INTEGER NULL,
    `closed_by_id` INTEGER NULL,
    `closed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `reporting_period_direction_id_program_date_key`(`direction_id`, `program`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `progress_entry` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `work_item_id` INTEGER NOT NULL,
    `period_id` INTEGER NOT NULL,
    `status_id` INTEGER NULL,
    `pct` DECIMAL(6, 2) NULL,
    `fact_qty` DECIMAL(18, 3) NULL,
    `ks_amount` DECIMAL(18, 2) NULL,
    `paid_amount` DECIMAL(18, 2) NULL,
    `attrs` JSON NULL,
    `note` VARCHAR(1000) NULL,
    `source` ENUM('MANUAL', 'IMPORT', 'MIGRATION', 'API') NOT NULL DEFAULT 'MANUAL',
    `is_example` BOOLEAN NOT NULL DEFAULT false,
    `version` INTEGER NOT NULL DEFAULT 1,
    `entered_by_id` INTEGER NULL,
    `entered_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_by_id` INTEGER NULL,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `progress_entry_period_id_idx`(`period_id`),
    UNIQUE INDEX `progress_entry_work_item_id_period_id_key`(`work_item_id`, `period_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `site_report` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `site_id` INTEGER NOT NULL,
    `period_id` INTEGER NOT NULL,
    `workers` INTEGER NULL,
    `machines` INTEGER NULL,
    `workers_blocked` INTEGER NULL,
    `machines_blocked` INTEGER NULL,
    `ks_amount` DECIMAL(18, 2) NULL,
    `advance_amount` DECIMAL(18, 2) NULL,
    `paid_amount` DECIMAL(18, 2) NULL,
    `status_text` VARCHAR(200) NULL,
    `remarks_count` INTEGER NULL,
    `attrs` JSON NULL,
    `note` VARCHAR(1000) NULL,
    `source` ENUM('MANUAL', 'IMPORT', 'MIGRATION', 'API') NOT NULL DEFAULT 'MANUAL',
    `is_example` BOOLEAN NOT NULL DEFAULT false,
    `entered_by_id` INTEGER NULL,
    `entered_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `site_report_period_id_idx`(`period_id`),
    UNIQUE INDEX `site_report_site_id_period_id_key`(`site_id`, `period_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `remark` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `site_id` INTEGER NOT NULL,
    `work_item_id` INTEGER NULL,
    `period_id` INTEGER NULL,
    `text` TEXT NOT NULL,
    `severity` ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NOT NULL DEFAULT 'MEDIUM',
    `status` ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'VERIFIED', 'REJECTED') NOT NULL DEFAULT 'OPEN',
    `due_date` DATE NULL,
    `author_id` INTEGER NULL,
    `assignee_id` INTEGER NULL,
    `resolved_by_id` INTEGER NULL,
    `resolved_at` DATETIME(3) NULL,
    `is_example` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `remark_site_id_status_idx`(`site_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tracker` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `direction_id` INTEGER NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `layout` ENUM('MATRIX', 'CARD') NOT NULL DEFAULT 'MATRIX',
    `description` VARCHAR(500) NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `tracker_direction_id_code_key`(`direction_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tracker_item` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tracker_id` INTEGER NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `name` VARCHAR(300) NOT NULL,
    `category` VARCHAR(200) NULL,
    `unit` VARCHAR(20) NULL,
    `attrs` JSON NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `is_archived` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `tracker_item_tracker_id_code_key`(`tracker_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tracker_stage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tracker_id` INTEGER NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `value_type` ENUM('BOOL', 'PERCENT', 'NUMBER', 'STATUS', 'DATE', 'TEXT') NOT NULL,
    `options` JSON NULL,
    `in_progress` BOOLEAN NOT NULL DEFAULT true,
    `sort` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `tracker_stage_tracker_id_code_key`(`tracker_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tracker_row` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `site_id` INTEGER NOT NULL,
    `item_id` INTEGER NOT NULL,
    `qty` DECIMAL(18, 3) NULL,
    `unit` VARCHAR(20) NULL,
    `plan_date` DATE NULL,
    `due_date` DATE NULL,
    `attrs` JSON NULL,
    `note` VARCHAR(1000) NULL,
    `is_example` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `tracker_row_site_id_item_id_key`(`site_id`, `item_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tracker_value` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `row_id` INTEGER NOT NULL,
    `stage_id` INTEGER NOT NULL,
    `value_num` DECIMAL(18, 4) NULL,
    `value_text` VARCHAR(500) NULL,
    `value_date` DATE NULL,
    `value_bool` BOOLEAN NULL,
    `updated_by_id` INTEGER NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tracker_value_row_id_stage_id_key`(`row_id`, `stage_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attachment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `site_id` INTEGER NULL,
    `entity` VARCHAR(40) NOT NULL,
    `entity_id` INTEGER NOT NULL,
    `file_name` VARCHAR(300) NOT NULL,
    `mime_type` VARCHAR(100) NOT NULL,
    `size` INTEGER NOT NULL,
    `storage_path` VARCHAR(500) NOT NULL,
    `uploaded_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `attachment_entity_entity_id_idx`(`entity`, `entity_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dashboard_layout` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `scope` ENUM('OVERVIEW', 'DIRECTION', 'SITE') NOT NULL,
    `direction_id` INTEGER NULL,
    `user_id` INTEGER NULL,
    `name` VARCHAR(200) NOT NULL,
    `layout` JSON NOT NULL,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `dashboard_layout_scope_direction_id_user_id_idx`(`scope`, `direction_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `kpi_snapshot` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `direction_id` INTEGER NOT NULL,
    `period_id` INTEGER NULL,
    `as_of` DATE NOT NULL,
    `payload` JSON NOT NULL,
    `computed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `kpi_snapshot_direction_id_as_of_idx`(`direction_id`, `as_of`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `app_setting` (
    `key` VARCHAR(64) NOT NULL,
    `value` JSON NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_log` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `user_id` INTEGER NULL,
    `action` ENUM('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'IMPORT', 'EXPORT', 'PERIOD_OPEN', 'PERIOD_CLOSE', 'PASSWORD_CHANGE') NOT NULL,
    `entity` VARCHAR(40) NOT NULL,
    `entity_id` VARCHAR(64) NULL,
    `direction_id` INTEGER NULL,
    `site_id` INTEGER NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `comment` VARCHAR(1000) NULL,
    `ip` VARCHAR(45) NULL,

    INDEX `audit_log_entity_entity_id_idx`(`entity`, `entity_id`),
    INDEX `audit_log_user_id_at_idx`(`user_id`, `at`),
    INDEX `audit_log_direction_id_at_idx`(`direction_id`, `at`),
    INDEX `audit_log_site_id_at_idx`(`site_id`, `at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user` ADD CONSTRAINT `user_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_session` ADD CONSTRAINT `user_session_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `direction_member` ADD CONSTRAINT `direction_member_direction_id_fkey` FOREIGN KEY (`direction_id`) REFERENCES `direction`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `direction_member` ADD CONSTRAINT `direction_member_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `direction_member_section` ADD CONSTRAINT `direction_member_section_member_id_fkey` FOREIGN KEY (`member_id`) REFERENCES `direction_member`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `direction_member_section` ADD CONSTRAINT `direction_member_section_section_id_fkey` FOREIGN KEY (`section_id`) REFERENCES `section`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `organization` ADD CONSTRAINT `organization_direction_id_fkey` FOREIGN KEY (`direction_id`) REFERENCES `direction`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `section` ADD CONSTRAINT `section_direction_id_fkey` FOREIGN KEY (`direction_id`) REFERENCES `direction`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_group` ADD CONSTRAINT `work_group_direction_id_fkey` FOREIGN KEY (`direction_id`) REFERENCES `direction`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_type` ADD CONSTRAINT `work_type_direction_id_fkey` FOREIGN KEY (`direction_id`) REFERENCES `direction`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_type` ADD CONSTRAINT `work_type_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `work_group`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `status_def` ADD CONSTRAINT `status_def_direction_id_fkey` FOREIGN KEY (`direction_id`) REFERENCES `direction`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `field_def` ADD CONSTRAINT `field_def_direction_id_fkey` FOREIGN KEY (`direction_id`) REFERENCES `direction`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `site` ADD CONSTRAINT `site_direction_id_fkey` FOREIGN KEY (`direction_id`) REFERENCES `direction`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `site` ADD CONSTRAINT `site_section_id_fkey` FOREIGN KEY (`section_id`) REFERENCES `section`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `site` ADD CONSTRAINT `site_status_id_fkey` FOREIGN KEY (`status_id`) REFERENCES `status_def`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `site` ADD CONSTRAINT `site_contractor_id_fkey` FOREIGN KEY (`contractor_id`) REFERENCES `organization`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `site` ADD CONSTRAINT `site_designer_id_fkey` FOREIGN KEY (`designer_id`) REFERENCES `organization`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `site` ADD CONSTRAINT `site_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `site` ADD CONSTRAINT `site_updated_by_id_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `site_assignment` ADD CONSTRAINT `site_assignment_site_id_fkey` FOREIGN KEY (`site_id`) REFERENCES `site`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `site_assignment` ADD CONSTRAINT `site_assignment_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_item` ADD CONSTRAINT `work_item_site_id_fkey` FOREIGN KEY (`site_id`) REFERENCES `site`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_item` ADD CONSTRAINT `work_item_work_type_id_fkey` FOREIGN KEY (`work_type_id`) REFERENCES `work_type`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_item` ADD CONSTRAINT `work_item_responsible_id_fkey` FOREIGN KEY (`responsible_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_item` ADD CONSTRAINT `work_item_contractor_id_fkey` FOREIGN KEY (`contractor_id`) REFERENCES `organization`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_item` ADD CONSTRAINT `work_item_contract_id_fkey` FOREIGN KEY (`contract_id`) REFERENCES `contract`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contract` ADD CONSTRAINT `contract_site_id_fkey` FOREIGN KEY (`site_id`) REFERENCES `site`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contract` ADD CONSTRAINT `contract_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reporting_period` ADD CONSTRAINT `reporting_period_direction_id_fkey` FOREIGN KEY (`direction_id`) REFERENCES `direction`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reporting_period` ADD CONSTRAINT `reporting_period_opened_by_id_fkey` FOREIGN KEY (`opened_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reporting_period` ADD CONSTRAINT `reporting_period_closed_by_id_fkey` FOREIGN KEY (`closed_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `progress_entry` ADD CONSTRAINT `progress_entry_work_item_id_fkey` FOREIGN KEY (`work_item_id`) REFERENCES `work_item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `progress_entry` ADD CONSTRAINT `progress_entry_period_id_fkey` FOREIGN KEY (`period_id`) REFERENCES `reporting_period`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `progress_entry` ADD CONSTRAINT `progress_entry_status_id_fkey` FOREIGN KEY (`status_id`) REFERENCES `status_def`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `progress_entry` ADD CONSTRAINT `progress_entry_entered_by_id_fkey` FOREIGN KEY (`entered_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `progress_entry` ADD CONSTRAINT `progress_entry_updated_by_id_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `site_report` ADD CONSTRAINT `site_report_site_id_fkey` FOREIGN KEY (`site_id`) REFERENCES `site`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `site_report` ADD CONSTRAINT `site_report_period_id_fkey` FOREIGN KEY (`period_id`) REFERENCES `reporting_period`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `site_report` ADD CONSTRAINT `site_report_entered_by_id_fkey` FOREIGN KEY (`entered_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `remark` ADD CONSTRAINT `remark_site_id_fkey` FOREIGN KEY (`site_id`) REFERENCES `site`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `remark` ADD CONSTRAINT `remark_work_item_id_fkey` FOREIGN KEY (`work_item_id`) REFERENCES `work_item`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `remark` ADD CONSTRAINT `remark_period_id_fkey` FOREIGN KEY (`period_id`) REFERENCES `reporting_period`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `remark` ADD CONSTRAINT `remark_author_id_fkey` FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `remark` ADD CONSTRAINT `remark_assignee_id_fkey` FOREIGN KEY (`assignee_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `remark` ADD CONSTRAINT `remark_resolved_by_id_fkey` FOREIGN KEY (`resolved_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tracker` ADD CONSTRAINT `tracker_direction_id_fkey` FOREIGN KEY (`direction_id`) REFERENCES `direction`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tracker_item` ADD CONSTRAINT `tracker_item_tracker_id_fkey` FOREIGN KEY (`tracker_id`) REFERENCES `tracker`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tracker_stage` ADD CONSTRAINT `tracker_stage_tracker_id_fkey` FOREIGN KEY (`tracker_id`) REFERENCES `tracker`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tracker_row` ADD CONSTRAINT `tracker_row_site_id_fkey` FOREIGN KEY (`site_id`) REFERENCES `site`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tracker_row` ADD CONSTRAINT `tracker_row_item_id_fkey` FOREIGN KEY (`item_id`) REFERENCES `tracker_item`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tracker_value` ADD CONSTRAINT `tracker_value_row_id_fkey` FOREIGN KEY (`row_id`) REFERENCES `tracker_row`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tracker_value` ADD CONSTRAINT `tracker_value_stage_id_fkey` FOREIGN KEY (`stage_id`) REFERENCES `tracker_stage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tracker_value` ADD CONSTRAINT `tracker_value_updated_by_id_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attachment` ADD CONSTRAINT `attachment_site_id_fkey` FOREIGN KEY (`site_id`) REFERENCES `site`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attachment` ADD CONSTRAINT `attachment_uploaded_by_id_fkey` FOREIGN KEY (`uploaded_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dashboard_layout` ADD CONSTRAINT `dashboard_layout_direction_id_fkey` FOREIGN KEY (`direction_id`) REFERENCES `direction`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dashboard_layout` ADD CONSTRAINT `dashboard_layout_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `kpi_snapshot` ADD CONSTRAINT `kpi_snapshot_direction_id_fkey` FOREIGN KEY (`direction_id`) REFERENCES `direction`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `kpi_snapshot` ADD CONSTRAINT `kpi_snapshot_period_id_fkey` FOREIGN KEY (`period_id`) REFERENCES `reporting_period`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_log` ADD CONSTRAINT `audit_log_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

