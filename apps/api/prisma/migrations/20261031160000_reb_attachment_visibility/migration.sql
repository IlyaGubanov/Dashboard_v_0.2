-- Аддитивно: существующие файлы сохраняют свой прежний доступ.
ALTER TABLE `attachment` ADD COLUMN `visibility` VARCHAR(20) NOT NULL DEFAULT 'GENERAL';
