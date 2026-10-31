-- Неизвестная дата проезда и неизвестное время ДТП хранятся явно, без выдуманных дат.
ALTER TABLE `fleet_toll` MODIFY COLUMN `passageDate` DATE NULL;
ALTER TABLE `fleet_incident` ADD COLUMN `timeKnown` BOOLEAN NOT NULL DEFAULT true;
