-- Этап 9а: замечания с жизненным циклом и лентой событий, архив вложений.

-- AlterTable
ALTER TABLE `attachment` ADD COLUMN `is_archived` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: новые обязательные колонки сначала допускают NULL, заполняются для старых строк, затем становятся NOT NULL
ALTER TABLE `remark` ADD COLUMN `category` VARCHAR(100) NULL,
    ADD COLUMN `direction_id` INTEGER NULL,
    ADD COLUMN `num` INTEGER NULL,
    ADD COLUMN `version` INTEGER NOT NULL DEFAULT 1;

UPDATE `remark` r JOIN `site` s ON s.id = r.site_id SET r.direction_id = s.direction_id;
UPDATE `remark` r
  JOIN (SELECT id, ROW_NUMBER() OVER (PARTITION BY direction_id ORDER BY id) AS n FROM `remark`) x ON x.id = r.id
  SET r.num = x.n;

ALTER TABLE `remark` MODIFY `direction_id` INTEGER NOT NULL,
    MODIFY `num` INTEGER NOT NULL;

-- CreateTable
CREATE TABLE `remark_event` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `remark_id` INTEGER NOT NULL,
    `kind` VARCHAR(20) NOT NULL,
    `from_status` ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'VERIFIED', 'REJECTED') NULL,
    `to_status` ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'VERIFIED', 'REJECTED') NULL,
    `text` TEXT NULL,
    `author_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `remark_event_remark_id_idx`(`remark_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `remark_direction_id_status_idx` ON `remark`(`direction_id`, `status`);

-- CreateIndex
CREATE UNIQUE INDEX `remark_direction_id_num_key` ON `remark`(`direction_id`, `num`);

-- AddForeignKey
ALTER TABLE `remark` ADD CONSTRAINT `remark_direction_id_fkey` FOREIGN KEY (`direction_id`) REFERENCES `direction`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `remark_event` ADD CONSTRAINT `remark_event_remark_id_fkey` FOREIGN KEY (`remark_id`) REFERENCES `remark`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `remark_event` ADD CONSTRAINT `remark_event_author_id_fkey` FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
