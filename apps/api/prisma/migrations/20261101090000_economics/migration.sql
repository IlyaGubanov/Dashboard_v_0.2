-- CreateTable
CREATE TABLE `econ_article` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(40) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `kind` ENUM('DIRECT', 'OVERHEAD', 'ADMIN') NOT NULL,
    `method` TEXT NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `is_archived` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `econ_article_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `econ_budget` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `direction_id` INTEGER NOT NULL,
    `scope` ENUM('DIRECTION', 'SECTION', 'SITE') NOT NULL,
    `scope_key` VARCHAR(20) NOT NULL,
    `section_id` INTEGER NULL,
    `site_id` INTEGER NULL,
    `cost_net` DECIMAL(18, 2) NULL,
    `vat_exempt` BOOLEAN NOT NULL DEFAULT false,
    `labor_hours_norm` DECIMAL(14, 2) NULL,
    `machine_hours_norm` DECIMAL(14, 2) NULL,
    `note` TEXT NULL,
    `is_archived` BOOLEAN NOT NULL DEFAULT false,
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `econ_budget_direction_id_scope_key_key`(`direction_id`, `scope_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `econ_limit` (
    `budget_id` INTEGER NOT NULL,
    `article_id` INTEGER NOT NULL,
    `method` ENUM('SHARE', 'AMOUNT') NOT NULL,
    `share_pct` DECIMAL(7, 3) NULL,
    `amount` DECIMAL(18, 2) NULL,
    `set_by` VARCHAR(200) NULL,
    `note` VARCHAR(2000) NULL,

    INDEX `econ_limit_article_id_idx`(`article_id`),
    PRIMARY KEY (`budget_id`, `article_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `econ_month` (
    `month` CHAR(7) NOT NULL,
    `status` ENUM('OPEN', 'CLOSED', 'LOCKED') NOT NULL DEFAULT 'OPEN',
    `version` INTEGER NOT NULL DEFAULT 1,
    `closed_by_id` INTEGER NULL,
    `closed_at` DATETIME(3) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`month`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `econ_company_fact` (
    `month` CHAR(7) NOT NULL,
    `article_id` INTEGER NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,

    INDEX `econ_company_fact_article_id_idx`(`article_id`),
    PRIMARY KEY (`month`, `article_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `econ_budget_month` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `budget_id` INTEGER NOT NULL,
    `month` CHAR(7) NOT NULL,
    `labor_hours` DECIMAL(14, 2) NULL,
    `machine_hours` DECIMAL(14, 2) NULL,
    `note` VARCHAR(2000) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `updated_by_id` INTEGER NULL,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `econ_budget_month_month_idx`(`month`),
    UNIQUE INDEX `econ_budget_month_budget_id_month_key`(`budget_id`, `month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `econ_fact` (
    `budget_month_id` INTEGER NOT NULL,
    `article_id` INTEGER NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,

    INDEX `econ_fact_article_id_idx`(`article_id`),
    PRIMARY KEY (`budget_month_id`, `article_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `econ_editor` (
    `user_id` INTEGER NOT NULL,

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `econ_budget` ADD CONSTRAINT `econ_budget_direction_id_fkey` FOREIGN KEY (`direction_id`) REFERENCES `direction`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `econ_budget` ADD CONSTRAINT `econ_budget_section_id_fkey` FOREIGN KEY (`section_id`) REFERENCES `section`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `econ_budget` ADD CONSTRAINT `econ_budget_site_id_fkey` FOREIGN KEY (`site_id`) REFERENCES `site`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `econ_limit` ADD CONSTRAINT `econ_limit_budget_id_fkey` FOREIGN KEY (`budget_id`) REFERENCES `econ_budget`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `econ_limit` ADD CONSTRAINT `econ_limit_article_id_fkey` FOREIGN KEY (`article_id`) REFERENCES `econ_article`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `econ_company_fact` ADD CONSTRAINT `econ_company_fact_month_fkey` FOREIGN KEY (`month`) REFERENCES `econ_month`(`month`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `econ_company_fact` ADD CONSTRAINT `econ_company_fact_article_id_fkey` FOREIGN KEY (`article_id`) REFERENCES `econ_article`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `econ_budget_month` ADD CONSTRAINT `econ_budget_month_budget_id_fkey` FOREIGN KEY (`budget_id`) REFERENCES `econ_budget`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `econ_fact` ADD CONSTRAINT `econ_fact_budget_month_id_fkey` FOREIGN KEY (`budget_month_id`) REFERENCES `econ_budget_month`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `econ_fact` ADD CONSTRAINT `econ_fact_article_id_fkey` FOREIGN KEY (`article_id`) REFERENCES `econ_article`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `econ_editor` ADD CONSTRAINT `econ_editor_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- Статьи расходов по умолчанию (таблица ПЭО «Экономическая часть дашборда»). Справочник можно дополнять в интерфейсе.
INSERT INTO `econ_article` (`code`, `name`, `kind`, `method`, `sort`) VALUES
  ('fot', 'ФОТ рабочих', 'DIRECT', '1. Усреднённой долей % от стоимости объекта.\n2. Трудочасы из ресурсного графика × средняя тарифная ставка за час.', 10),
  ('materials', 'Материалы', 'DIRECT', '1. Усреднённой долей % от стоимости объекта.\n2. По расценённой отделом снабжения ЛЗК (спецификации).', 20),
  ('machinery', 'Техника', 'DIRECT', '1. Усреднённой долей % от стоимости объекта.\n2. По ресурсному графику машин и механизмов: часы × стоимость часа работы техники.', 30),
  ('subcontract', 'Субподряд', 'DIRECT', '1. Усреднённой долей % от стоимости объекта (аналитика аналогичных объектов).\n2. По данным производства с расчётной стоимостью работ субподрядчиков.', 40),
  ('waste', 'Вывоз строительного мусора', 'DIRECT', '1. Усреднённой долей % от стоимости объекта (аналитика аналогичных проектов).\n2. По объёмам вывоза от производства и стоимости от отдела снабжения.', 50),
  ('overhead', 'Общепроизводственные/общехозяйственные расходы', 'OVERHEAD', '1. Усреднённой долей % от стоимости объекта.\n2. По собранным общепроизводственным расходам прошлых лет на аналогичные проекты.', 60),
  ('admin', 'Административные расходы', 'ADMIN', '1. Усреднённой долей % от стоимости объекта.\n2. Доля выручки объекта в производственной программе × годовые административные расходы.', 70)
ON DUPLICATE KEY UPDATE `code` = `code`;
