-- AlterTable
ALTER TABLE `econ_budget_month` ADD COLUMN `materials_purchased` DECIMAL(18, 2) NULL;

-- CreateTable
CREATE TABLE `econ_deviation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `budget_id` INTEGER NOT NULL,
    `article_id` INTEGER NOT NULL,
    `kind` ENUM('OVERRUN', 'STOCK') NOT NULL,
    `month` CHAR(7) NOT NULL,
    `plan` DECIMAL(18, 2) NULL,
    `fact` DECIMAL(18, 2) NULL,
    `amount` DECIMAL(18, 2) NULL,
    `pct` DECIMAL(9, 4) NULL,
    `cause` VARCHAR(40) NOT NULL,
    `cause_text` VARCHAR(2000) NULL,
    `decision` VARCHAR(40) NOT NULL,
    `decision_text` VARCHAR(2000) NULL,
    `responsible_id` INTEGER NULL,
    `due_date` DATE NULL,
    `status` ENUM('OPEN', 'IN_WORK', 'RESOLVED', 'DISMISSED') NOT NULL DEFAULT 'OPEN',
    `result` VARCHAR(2000) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_by_id` INTEGER NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `closed_at` DATETIME(3) NULL,

    INDEX `econ_deviation_budget_id_article_id_status_idx`(`budget_id`, `article_id`, `status`),
    INDEX `econ_deviation_responsible_id_status_idx`(`responsible_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `econ_deviation` ADD CONSTRAINT `econ_deviation_budget_id_fkey` FOREIGN KEY (`budget_id`) REFERENCES `econ_budget`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `econ_deviation` ADD CONSTRAINT `econ_deviation_article_id_fkey` FOREIGN KEY (`article_id`) REFERENCES `econ_article`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `econ_deviation` ADD CONSTRAINT `econ_deviation_responsible_id_fkey` FOREIGN KEY (`responsible_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

