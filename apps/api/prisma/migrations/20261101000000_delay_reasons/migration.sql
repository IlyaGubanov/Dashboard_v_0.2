CREATE TABLE `delay_reason` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `work_item_id` INTEGER NOT NULL,
  `period_id` INTEGER NOT NULL,
  `text` TEXT NOT NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `updated_by_id` INTEGER NULL,
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `delay_reason_work_item_id_period_id_key` (`work_item_id`, `period_id`),
  INDEX `delay_reason_period_id_idx` (`period_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `delay_reason_work_item_id_fkey` FOREIGN KEY (`work_item_id`) REFERENCES `work_item` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `delay_reason_period_id_fkey` FOREIGN KEY (`period_id`) REFERENCES `reporting_period` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `delay_reason_updated_by_id_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
