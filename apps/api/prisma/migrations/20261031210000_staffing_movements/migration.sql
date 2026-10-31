-- Приём и увольнение по дням (раздел «Штатная численность»). Новая таблица, существующие строки не затрагиваются.
CREATE TABLE `staffing_movement_day` (
    `date` CHAR(10) NOT NULL,
    `data` JSON NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `updated_at` DATETIME(3) NOT NULL,
    PRIMARY KEY (`date`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
