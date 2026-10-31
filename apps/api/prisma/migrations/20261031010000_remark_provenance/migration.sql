-- Необязательные поля реального нарушения; существующие записи сохраняются.
ALTER TABLE `remark`
  ADD COLUMN `source_name` VARCHAR(100) NULL,
  ADD COLUMN `source_ref` VARCHAR(300) NULL,
  ADD COLUMN `detected_on` DATE NULL,
  ADD COLUMN `type_name` VARCHAR(300) NULL,
  ADD COLUMN `location` VARCHAR(120) NULL,
  ADD COLUMN `responsible_id` INTEGER NULL;
ALTER TABLE `remark` ADD CONSTRAINT `remark_responsible_id_fkey`
  FOREIGN KEY (`responsible_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
