-- Общие вложения сохраняют исходный формат; поля панорам необязательны для прежних файлов.
ALTER TABLE `attachment`
  ADD COLUMN `material_type` ENUM('FILE','PANORAMA360') NOT NULL DEFAULT 'FILE',
  ADD COLUMN `captured_on` DATE NULL,
  ADD COLUMN `description` VARCHAR(1000) NULL;
CREATE INDEX `attachment_site_id_material_type_is_archived_captured_on_idx`
  ON `attachment`(`site_id`,`material_type`,`is_archived`,`captured_on`);
