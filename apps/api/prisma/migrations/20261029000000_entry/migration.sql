-- AlterTable
ALTER TABLE `site_report` ADD COLUMN `updated_by_id` INTEGER NULL,
    ADD COLUMN `version` INTEGER NOT NULL DEFAULT 1;

-- AddForeignKey
ALTER TABLE `site_report` ADD CONSTRAINT `site_report_updated_by_id_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

