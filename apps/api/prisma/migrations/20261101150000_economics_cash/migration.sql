-- CreateTable
CREATE TABLE `econ_cash_article` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(40) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `kind` ENUM('IN', 'OUT') NOT NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `is_archived` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `econ_cash_article_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `econ_cash_sheet` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `scope` VARCHAR(12) NOT NULL,
    `direction_id` INTEGER NULL,
    `year` INTEGER NOT NULL,
    `opening` DECIMAL(18, 2) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `updated_by_id` INTEGER NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `econ_cash_sheet_scope_year_key`(`scope`, `year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `econ_cash_entry` (
    `sheet_id` INTEGER NOT NULL,
    `month` CHAR(7) NOT NULL,
    `article_id` INTEGER NOT NULL,
    `plan` DECIMAL(18, 2) NULL,
    `fact` DECIMAL(18, 2) NULL,

    INDEX `econ_cash_entry_article_id_idx`(`article_id`),
    PRIMARY KEY (`sheet_id`, `month`, `article_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `econ_cash_sheet` ADD CONSTRAINT `econ_cash_sheet_direction_id_fkey` FOREIGN KEY (`direction_id`) REFERENCES `direction`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `econ_cash_entry` ADD CONSTRAINT `econ_cash_entry_sheet_id_fkey` FOREIGN KEY (`sheet_id`) REFERENCES `econ_cash_sheet`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `econ_cash_entry` ADD CONSTRAINT `econ_cash_entry_article_id_fkey` FOREIGN KEY (`article_id`) REFERENCES `econ_cash_article`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- Статьи ДДС по умолчанию (часть 3 таблицы ПЭО «Экономическая часть дашборда»)
INSERT INTO `econ_cash_article` (`code`, `name`, `kind`, `sort`) VALUES
  ('in_subsidy', 'Субсидии/гранты', 'IN', 10),
  ('in_commercial', 'Коммерческие контракты', 'IN', 20),
  ('in_special', 'Специализированные работы', 'IN', 30),
  ('in_other', 'Прочие поступления', 'IN', 40),
  ('in_invest', 'Поступления по инвестиционной деятельности', 'IN', 50),
  ('fot', 'ФОТ (рабочих)', 'OUT', 110),
  ('materials', 'Материалы', 'OUT', 120),
  ('machinery', 'Техника', 'OUT', 130),
  ('subcontract', 'Субподряд', 'OUT', 140),
  ('waste', 'Вывоз строительного мусора', 'OUT', 150),
  ('overhead', 'Общепроизводственные/общехозяйственные расходы', 'OUT', 160),
  ('admin', 'Административные расходы', 'OUT', 170),
  ('vat', 'НДС', 'OUT', 180)
ON DUPLICATE KEY UPDATE `code` = `code`;
