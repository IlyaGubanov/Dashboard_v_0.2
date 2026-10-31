-- Самостоятельная РЭБ. Старые идентификаторы, записи и роли сохраняются.
CREATE TABLE `fleet_registry` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(40) NOT NULL,
  `name` VARCHAR(200) NOT NULL,
  `is_readonly` BOOLEAN NOT NULL DEFAULT false,
  UNIQUE INDEX `fleet_registry_code_key` (`code`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
INSERT INTO `fleet_registry` (`id`,`code`,`name`,`is_readonly`)
  SELECT `id`,`code`,`name`,`is_readonly` FROM `direction` WHERE `code`='reb';
INSERT INTO `fleet_registry` (`id`,`code`,`name`) SELECT 1,'reb','Ремонтно-эксплуатационная база'
  WHERE NOT EXISTS (SELECT 1 FROM `fleet_registry` WHERE `code`='reb');
CREATE TABLE `fleet_member` (
  `registry_id` INTEGER NOT NULL, `user_id` INTEGER NOT NULL,
  `role` ENUM('CURATOR','EDITOR','VIEWER') NOT NULL,
  `scope` ENUM('ALL','SECTIONS','SITES') NOT NULL DEFAULT 'ALL',
  PRIMARY KEY (`registry_id`,`user_id`),
  CONSTRAINT `fleet_member_registry_id_fkey` FOREIGN KEY (`registry_id`) REFERENCES `fleet_registry`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fleet_member_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
INSERT INTO `fleet_member` (`registry_id`,`user_id`,`role`,`scope`)
  SELECT m.`direction_id`,m.`user_id`,m.`role`,m.`scope` FROM `direction_member` m
  JOIN `direction` d ON d.`id`=m.`direction_id` WHERE d.`code`='reb';
-- Физическая колонка directionId оставлена для совместимости с существующими записями.
ALTER TABLE `fleet_vehicle` DROP FOREIGN KEY `fleet_vehicle_directionId_fkey`, ADD CONSTRAINT `fleet_vehicle_registry_fkey` FOREIGN KEY (`directionId`) REFERENCES `fleet_registry`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `fleet_assignment` DROP FOREIGN KEY `fleet_assignment_directionId_fkey`, ADD CONSTRAINT `fleet_assignment_registry_fkey` FOREIGN KEY (`directionId`) REFERENCES `fleet_registry`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `fleet_incident` DROP FOREIGN KEY `fleet_incident_directionId_fkey`, ADD CONSTRAINT `fleet_incident_registry_fkey` FOREIGN KEY (`directionId`) REFERENCES `fleet_registry`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `fleet_fine` DROP FOREIGN KEY `fleet_fine_directionId_fkey`, ADD CONSTRAINT `fleet_fine_registry_fkey` FOREIGN KEY (`directionId`) REFERENCES `fleet_registry`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `fleet_toll` DROP FOREIGN KEY `fleet_toll_directionId_fkey`, ADD CONSTRAINT `fleet_toll_registry_fkey` FOREIGN KEY (`directionId`) REFERENCES `fleet_registry`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `fleet_fuel` DROP FOREIGN KEY `fleet_fuel_directionId_fkey`, ADD CONSTRAINT `fleet_fuel_registry_fkey` FOREIGN KEY (`directionId`) REFERENCES `fleet_registry`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `fleet_downtime` DROP FOREIGN KEY `fleet_downtime_directionId_fkey`, ADD CONSTRAINT `fleet_downtime_registry_fkey` FOREIGN KEY (`directionId`) REFERENCES `fleet_registry`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `fleet_request` DROP FOREIGN KEY `fleet_request_directionId_fkey`, ADD CONSTRAINT `fleet_request_registry_fkey` FOREIGN KEY (`directionId`) REFERENCES `fleet_registry`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `fleet_snapshot` DROP FOREIGN KEY `fleet_snapshot_directionId_fkey`, ADD CONSTRAINT `fleet_snapshot_registry_fkey` FOREIGN KEY (`directionId`) REFERENCES `fleet_registry`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `fleet_import_batch` DROP FOREIGN KEY `fleet_import_batch_directionId_fkey`, ADD CONSTRAINT `fleet_import_batch_registry_fkey` FOREIGN KEY (`directionId`) REFERENCES `fleet_registry`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
