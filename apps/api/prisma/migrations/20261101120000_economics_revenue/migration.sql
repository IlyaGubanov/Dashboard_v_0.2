-- AlterTable
ALTER TABLE `econ_budget_month` ADD COLUMN `ks_amount` DECIMAL(18, 2) NULL,
    ADD COLUMN `nzp_note` VARCHAR(500) NULL,
    ADD COLUMN `nzp_override` DECIMAL(18, 2) NULL;

