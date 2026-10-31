-- CreateTable
CREATE TABLE `video_recorder` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `site_id` INTEGER NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `host` VARCHAR(253) NOT NULL,
    `port` INTEGER NOT NULL DEFAULT 554,
    `username` VARCHAR(128) NOT NULL,
    `password_encrypted` TEXT NOT NULL,
    `profile` VARCHAR(20) NOT NULL DEFAULT 'DAHUA',
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `is_archived` BOOLEAN NOT NULL DEFAULT false,
    `version` INTEGER NOT NULL DEFAULT 1,
    `last_check_at` DATETIME(3) NULL,
    `last_check` VARCHAR(40) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `created_by_id` INTEGER NULL,
    `updated_by_id` INTEGER NULL,

    INDEX `video_recorder_site_id_idx`(`site_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `video_camera` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `recorder_id` INTEGER NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `channel` INTEGER NOT NULL,
    `active_channel` INTEGER NULL,
    `stream` INTEGER NOT NULL DEFAULT 1,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `is_archived` BOOLEAN NOT NULL DEFAULT false,
    `version` INTEGER NOT NULL DEFAULT 1,
    `sync_state` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `sync_error` VARCHAR(300) NULL,
    `last_check_at` DATETIME(3) NULL,
    `last_check` VARCHAR(40) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `created_by_id` INTEGER NULL,
    `updated_by_id` INTEGER NULL,

    UNIQUE INDEX `video_camera_recorder_id_active_channel_key`(`recorder_id`, `active_channel`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `video_grant` (
    `user_id` INTEGER NOT NULL,
    `site_id` INTEGER NOT NULL,
    `can_manage` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`user_id`, `site_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `video_recorder` ADD CONSTRAINT `video_recorder_site_id_fkey` FOREIGN KEY (`site_id`) REFERENCES `site`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `video_recorder` ADD CONSTRAINT `video_recorder_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `video_recorder` ADD CONSTRAINT `video_recorder_updated_by_id_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `video_camera` ADD CONSTRAINT `video_camera_recorder_id_fkey` FOREIGN KEY (`recorder_id`) REFERENCES `video_recorder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `video_camera` ADD CONSTRAINT `video_camera_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `video_camera` ADD CONSTRAINT `video_camera_updated_by_id_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `video_grant` ADD CONSTRAINT `video_grant_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `video_grant` ADD CONSTRAINT `video_grant_site_id_fkey` FOREIGN KEY (`site_id`) REFERENCES `site`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
