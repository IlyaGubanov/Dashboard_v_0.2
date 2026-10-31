-- Типизированная сводка отчёта хранится у периода, отдельно от объектов и нарушений.
ALTER TABLE `reporting_period` ADD COLUMN `summary` JSON NULL;
