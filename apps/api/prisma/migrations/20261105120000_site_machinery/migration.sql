-- CreateTable
CREATE TABLE `site_machinery` (
    `report_id` INTEGER NOT NULL,
    `kind` VARCHAR(100) NOT NULL,
    `qty` INTEGER NOT NULL,

    PRIMARY KEY (`report_id`, `kind`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `site_machinery` ADD CONSTRAINT `site_machinery_report_id_fkey` FOREIGN KEY (`report_id`) REFERENCES `site_report`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

