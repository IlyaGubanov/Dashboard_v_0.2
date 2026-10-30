-- Карточка сотрудника: подразделение (справочник), скрытые разделы и отключённые возможности.
-- Новые колонки допускают NULL: у существующих сотрудников подразделение не задано, видно всё, что позволяют роли.

-- CreateTable
CREATE TABLE `department` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(200) NOT NULL,
    `is_archived` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `department_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `user` ADD COLUMN `department_id` INTEGER NULL,
    ADD COLUMN `hidden_sections` JSON NULL,
    ADD COLUMN `denied_features` JSON NULL;

-- AddForeignKey
ALTER TABLE `user` ADD CONSTRAINT `user_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
