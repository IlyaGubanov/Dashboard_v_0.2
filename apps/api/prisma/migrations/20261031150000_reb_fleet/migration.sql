-- CreateTable
CREATE TABLE `fleet_vehicle` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `directionId` INTEGER NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `isArchived` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdById` INTEGER NULL,
    `updatedById` INTEGER NULL,
    `importBatchId` INTEGER NULL,
    `sourceKey` CHAR(64) NULL,
    `sourceRaw` JSON NULL,
    `note` TEXT NULL,
    `inventoryNumber` VARCHAR(80) NULL,
    `plate` VARCHAR(32) NULL,
    `vin` VARCHAR(80) NULL,
    `name` VARCHAR(200) NOT NULL,
    `kind` VARCHAR(100) NOT NULL,
    `category` VARCHAR(100) NULL,
    `brand` VARCHAR(100) NULL,
    `model` VARCHAR(100) NULL,
    `ownership` VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN',
    `ownerId` INTEGER NULL,
    `rentStart` DATE NULL,
    `rentEnd` DATE NULL,
    `technicalState` VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN',
    `usageState` VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN',
    `employeeId` INTEGER NULL,
    `departmentId` INTEGER NULL,

    INDEX `fleet_vehicle_directionId_isArchived_updatedAt_idx`(`directionId`, `isArchived`, `updatedAt`),
    UNIQUE INDEX `fleet_vehicle_directionId_sourceKey_key`(`directionId`, `sourceKey`),
    UNIQUE INDEX `fleet_vehicle_directionId_inventoryNumber_key`(`directionId`, `inventoryNumber`),
    UNIQUE INDEX `fleet_vehicle_directionId_plate_key`(`directionId`, `plate`),
    UNIQUE INDEX `fleet_vehicle_directionId_vin_key`(`directionId`, `vin`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fleet_assignment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `directionId` INTEGER NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `isArchived` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdById` INTEGER NULL,
    `updatedById` INTEGER NULL,
    `importBatchId` INTEGER NULL,
    `sourceKey` CHAR(64) NULL,
    `sourceRaw` JSON NULL,
    `note` TEXT NULL,
    `vehicleId` INTEGER NOT NULL,
    `targetDirectionId` INTEGER NOT NULL,
    `siteId` INTEGER NULL,
    `employeeId` INTEGER NULL,
    `startDate` DATE NOT NULL,
    `endDate` DATE NULL,

    INDEX `fleet_assignment_directionId_isArchived_updatedAt_idx`(`directionId`, `isArchived`, `updatedAt`),
    INDEX `fleet_assignment_vehicleId_startDate_endDate_idx`(`vehicleId`, `startDate`, `endDate`),
    UNIQUE INDEX `fleet_assignment_directionId_sourceKey_key`(`directionId`, `sourceKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fleet_incident` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `directionId` INTEGER NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `isArchived` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdById` INTEGER NULL,
    `updatedById` INTEGER NULL,
    `importBatchId` INTEGER NULL,
    `sourceKey` CHAR(64) NULL,
    `sourceRaw` JSON NULL,
    `note` TEXT NULL,
    `vehicleId` INTEGER NULL,
    `plate` VARCHAR(32) NULL,
    `targetDirectionId` INTEGER NULL,
    `siteId` INTEGER NULL,
    `departmentId` INTEGER NULL,
    `employeeId` INTEGER NULL,
    `occurredAt` DATETIME(3) NOT NULL,
    `incidentType` VARCHAR(200) NOT NULL,
    `location` VARCHAR(500) NULL,
    `description` TEXT NULL,
    `cause` TEXT NULL,
    `registrationMethod` VARCHAR(200) NULL,
    `casualties` BOOLEAN NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'REVIEW',
    `culpritCategory` VARCHAR(200) NULL,
    `culpritConfirmed` BOOLEAN NOT NULL DEFAULT false,
    `conditionAfter` VARCHAR(500) NULL,
    `repairRequired` BOOLEAN NULL,
    `expectedReturn` DATE NULL,
    `actualReturn` DATE NULL,
    `delayReason` TEXT NULL,
    `damage` DECIMAL(15, 2) NULL,
    `repairCost` DECIMAL(15, 2) NULL,
    `insuranceCompensation` DECIMAL(15, 2) NULL,
    `thirdPartyCompensation` DECIMAL(15, 2) NULL,
    `recoveredAmount` DECIMAL(15, 2) NULL,

    INDEX `fleet_incident_directionId_isArchived_updatedAt_idx`(`directionId`, `isArchived`, `updatedAt`),
    UNIQUE INDEX `fleet_incident_directionId_sourceKey_key`(`directionId`, `sourceKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fleet_fine` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `directionId` INTEGER NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `isArchived` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdById` INTEGER NULL,
    `updatedById` INTEGER NULL,
    `importBatchId` INTEGER NULL,
    `sourceKey` CHAR(64) NULL,
    `sourceRaw` JSON NULL,
    `note` TEXT NULL,
    `uin` VARCHAR(80) NULL,
    `violationDate` DATE NULL,
    `violation` TEXT NOT NULL,
    `fullAmount` DECIMAL(15, 2) NULL,
    `confirmedDiscount` DECIMAL(15, 2) NULL,
    `discountUntil` DATE NULL,
    `dueDate` DATE NULL,
    `submittedDate` DATE NULL,
    `vehicleId` INTEGER NULL,
    `plate` VARCHAR(32) NULL,
    `targetDirectionId` INTEGER NULL,
    `siteId` INTEGER NULL,
    `departmentId` INTEGER NULL,
    `employeeId` INTEGER NULL,
    `chargeDate` DATE NULL,
    `detectedDate` DATE NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `paidAmount` DECIMAL(15, 2) NULL,
    `paidDate` DATE NULL,
    `paymentDocument` VARCHAR(500) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'REVIEW',
    `sourceStatus` VARCHAR(200) NULL,

    INDEX `fleet_fine_directionId_isArchived_updatedAt_idx`(`directionId`, `isArchived`, `updatedAt`),
    UNIQUE INDEX `fleet_fine_directionId_sourceKey_key`(`directionId`, `sourceKey`),
    UNIQUE INDEX `fleet_fine_directionId_uin_key`(`directionId`, `uin`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fleet_toll` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `directionId` INTEGER NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `isArchived` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdById` INTEGER NULL,
    `updatedById` INTEGER NULL,
    `importBatchId` INTEGER NULL,
    `sourceKey` CHAR(64) NULL,
    `sourceRaw` JSON NULL,
    `note` TEXT NULL,
    `chargeIdentifier` VARCHAR(100) NULL,
    `passageDate` DATE NOT NULL,
    `route` TEXT NOT NULL,
    `vehicleId` INTEGER NULL,
    `plate` VARCHAR(32) NULL,
    `targetDirectionId` INTEGER NULL,
    `siteId` INTEGER NULL,
    `departmentId` INTEGER NULL,
    `employeeId` INTEGER NULL,
    `chargeDate` DATE NULL,
    `detectedDate` DATE NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `paidAmount` DECIMAL(15, 2) NULL,
    `paidDate` DATE NULL,
    `paymentDocument` VARCHAR(500) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'REVIEW',
    `sourceStatus` VARCHAR(200) NULL,

    INDEX `fleet_toll_directionId_isArchived_updatedAt_idx`(`directionId`, `isArchived`, `updatedAt`),
    UNIQUE INDEX `fleet_toll_directionId_sourceKey_key`(`directionId`, `sourceKey`),
    UNIQUE INDEX `fleet_toll_directionId_chargeIdentifier_key`(`directionId`, `chargeIdentifier`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fleet_fuel` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `directionId` INTEGER NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `isArchived` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdById` INTEGER NULL,
    `updatedById` INTEGER NULL,
    `importBatchId` INTEGER NULL,
    `sourceKey` CHAR(64) NULL,
    `sourceRaw` JSON NULL,
    `note` TEXT NULL,
    `period` VARCHAR(7) NOT NULL,
    `fuelType` VARCHAR(80) NOT NULL,
    `category` VARCHAR(200) NOT NULL,
    `liters` DECIMAL(15, 2) NOT NULL,
    `cost` DECIMAL(15, 2) NULL,
    `dailyLiters` DECIMAL(15, 2) NULL,
    `dailyCost` DECIMAL(15, 2) NULL,
    `dailyMethod` TEXT NULL,
    `source` VARCHAR(500) NOT NULL,
    `isReportedTotal` BOOLEAN NOT NULL DEFAULT false,

    INDEX `fleet_fuel_directionId_isArchived_updatedAt_idx`(`directionId`, `isArchived`, `updatedAt`),
    UNIQUE INDEX `fleet_fuel_directionId_sourceKey_key`(`directionId`, `sourceKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fleet_downtime` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `directionId` INTEGER NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `isArchived` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdById` INTEGER NULL,
    `updatedById` INTEGER NULL,
    `importBatchId` INTEGER NULL,
    `sourceKey` CHAR(64) NULL,
    `sourceRaw` JSON NULL,
    `note` TEXT NULL,
    `vehicleId` INTEGER NOT NULL,
    `reason` VARCHAR(20) NOT NULL,
    `startDate` DATE NOT NULL,
    `endDate` DATE NULL,
    `expectedReturn` DATE NULL,
    `employeeId` INTEGER NULL,
    `comment` TEXT NULL,

    INDEX `fleet_downtime_directionId_isArchived_updatedAt_idx`(`directionId`, `isArchived`, `updatedAt`),
    INDEX `fleet_downtime_vehicleId_startDate_endDate_idx`(`vehicleId`, `startDate`, `endDate`),
    UNIQUE INDEX `fleet_downtime_directionId_sourceKey_key`(`directionId`, `sourceKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fleet_request` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `directionId` INTEGER NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `isArchived` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdById` INTEGER NULL,
    `updatedById` INTEGER NULL,
    `importBatchId` INTEGER NULL,
    `sourceKey` CHAR(64) NULL,
    `sourceRaw` JSON NULL,
    `note` TEXT NULL,
    `requestDate` DATE NOT NULL,
    `departmentId` INTEGER NULL,
    `targetDirectionId` INTEGER NULL,
    `siteId` INTEGER NULL,
    `kind` VARCHAR(100) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `workPurpose` TEXT NOT NULL,
    `reason` TEXT NOT NULL,
    `startDate` DATE NOT NULL,
    `endDate` DATE NOT NULL,
    `priority` VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
    `initiatorId` INTEGER NULL,
    `employeeId` INTEGER NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'NEW',
    `decisionReason` TEXT NULL,

    INDEX `fleet_request_directionId_isArchived_updatedAt_idx`(`directionId`, `isArchived`, `updatedAt`),
    UNIQUE INDEX `fleet_request_directionId_sourceKey_key`(`directionId`, `sourceKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fleet_snapshot` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `directionId` INTEGER NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `isArchived` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdById` INTEGER NULL,
    `updatedById` INTEGER NULL,
    `importBatchId` INTEGER NULL,
    `sourceKey` CHAR(64) NULL,
    `sourceRaw` JSON NULL,
    `note` TEXT NULL,
    `asOfDate` DATE NOT NULL,
    `source` VARCHAR(500) NOT NULL,
    `total` INTEGER NOT NULL,
    `used` INTEGER NULL,
    `unused` INTEGER NULL,
    `own` INTEGER NULL,
    `rented` INTEGER NULL,
    `repair` INTEGER NULL,
    `reserve` INTEGER NULL,
    `breakdown` JSON NOT NULL,
    `details` TEXT NULL,

    INDEX `fleet_snapshot_directionId_isArchived_updatedAt_idx`(`directionId`, `isArchived`, `updatedAt`),
    UNIQUE INDEX `fleet_snapshot_directionId_sourceKey_key`(`directionId`, `sourceKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fleet_allocation` (
    `requestId` INTEGER NOT NULL,
    `assignmentId` INTEGER NOT NULL,

    PRIMARY KEY (`requestId`, `assignmentId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fleet_incident_liability` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `incidentId` INTEGER NOT NULL,
    `employeeId` INTEGER NOT NULL,
    `confirmedAmount` DECIMAL(15, 2) NOT NULL,
    `recoveredAmount` DECIMAL(15, 2) NOT NULL,
    `evidence` TEXT NOT NULL,
    `note` TEXT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `fleet_incident_liability_incidentId_key`(`incidentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fleet_fuel_type` (
    `code` VARCHAR(80) NOT NULL,

    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fleet_import_batch` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `directionId` INTEGER NOT NULL,
    `createdById` INTEGER NOT NULL,
    `fileName` VARCHAR(200) NOT NULL,
    `fileHash` CHAR(64) NOT NULL,
    `kind` VARCHAR(20) NOT NULL,
    `mapping` JSON NOT NULL,
    `importedRows` INTEGER NOT NULL,
    `skippedRows` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `fleet_import_batch_directionId_createdAt_idx`(`directionId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `fleet_vehicle` ADD CONSTRAINT `fleet_vehicle_directionId_fkey` FOREIGN KEY (`directionId`) REFERENCES `direction`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_vehicle` ADD CONSTRAINT `fleet_vehicle_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_vehicle` ADD CONSTRAINT `fleet_vehicle_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_vehicle` ADD CONSTRAINT `fleet_vehicle_importBatchId_fkey` FOREIGN KEY (`importBatchId`) REFERENCES `fleet_import_batch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_vehicle` ADD CONSTRAINT `fleet_vehicle_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_vehicle` ADD CONSTRAINT `fleet_vehicle_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_vehicle` ADD CONSTRAINT `fleet_vehicle_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_assignment` ADD CONSTRAINT `fleet_assignment_directionId_fkey` FOREIGN KEY (`directionId`) REFERENCES `direction`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_assignment` ADD CONSTRAINT `fleet_assignment_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_assignment` ADD CONSTRAINT `fleet_assignment_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_assignment` ADD CONSTRAINT `fleet_assignment_importBatchId_fkey` FOREIGN KEY (`importBatchId`) REFERENCES `fleet_import_batch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_assignment` ADD CONSTRAINT `fleet_assignment_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `fleet_vehicle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_assignment` ADD CONSTRAINT `fleet_assignment_targetDirectionId_fkey` FOREIGN KEY (`targetDirectionId`) REFERENCES `direction`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_assignment` ADD CONSTRAINT `fleet_assignment_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `site`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_assignment` ADD CONSTRAINT `fleet_assignment_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_incident` ADD CONSTRAINT `fleet_incident_directionId_fkey` FOREIGN KEY (`directionId`) REFERENCES `direction`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_incident` ADD CONSTRAINT `fleet_incident_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_incident` ADD CONSTRAINT `fleet_incident_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_incident` ADD CONSTRAINT `fleet_incident_importBatchId_fkey` FOREIGN KEY (`importBatchId`) REFERENCES `fleet_import_batch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_incident` ADD CONSTRAINT `fleet_incident_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `fleet_vehicle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_incident` ADD CONSTRAINT `fleet_incident_targetDirectionId_fkey` FOREIGN KEY (`targetDirectionId`) REFERENCES `direction`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_incident` ADD CONSTRAINT `fleet_incident_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `site`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_incident` ADD CONSTRAINT `fleet_incident_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_incident` ADD CONSTRAINT `fleet_incident_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_fine` ADD CONSTRAINT `fleet_fine_directionId_fkey` FOREIGN KEY (`directionId`) REFERENCES `direction`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_fine` ADD CONSTRAINT `fleet_fine_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_fine` ADD CONSTRAINT `fleet_fine_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_fine` ADD CONSTRAINT `fleet_fine_importBatchId_fkey` FOREIGN KEY (`importBatchId`) REFERENCES `fleet_import_batch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_fine` ADD CONSTRAINT `fleet_fine_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `fleet_vehicle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_fine` ADD CONSTRAINT `fleet_fine_targetDirectionId_fkey` FOREIGN KEY (`targetDirectionId`) REFERENCES `direction`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_fine` ADD CONSTRAINT `fleet_fine_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `site`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_fine` ADD CONSTRAINT `fleet_fine_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_fine` ADD CONSTRAINT `fleet_fine_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_toll` ADD CONSTRAINT `fleet_toll_directionId_fkey` FOREIGN KEY (`directionId`) REFERENCES `direction`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_toll` ADD CONSTRAINT `fleet_toll_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_toll` ADD CONSTRAINT `fleet_toll_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_toll` ADD CONSTRAINT `fleet_toll_importBatchId_fkey` FOREIGN KEY (`importBatchId`) REFERENCES `fleet_import_batch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_toll` ADD CONSTRAINT `fleet_toll_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `fleet_vehicle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_toll` ADD CONSTRAINT `fleet_toll_targetDirectionId_fkey` FOREIGN KEY (`targetDirectionId`) REFERENCES `direction`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_toll` ADD CONSTRAINT `fleet_toll_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `site`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_toll` ADD CONSTRAINT `fleet_toll_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_toll` ADD CONSTRAINT `fleet_toll_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_fuel` ADD CONSTRAINT `fleet_fuel_directionId_fkey` FOREIGN KEY (`directionId`) REFERENCES `direction`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_fuel` ADD CONSTRAINT `fleet_fuel_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_fuel` ADD CONSTRAINT `fleet_fuel_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_fuel` ADD CONSTRAINT `fleet_fuel_importBatchId_fkey` FOREIGN KEY (`importBatchId`) REFERENCES `fleet_import_batch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_downtime` ADD CONSTRAINT `fleet_downtime_directionId_fkey` FOREIGN KEY (`directionId`) REFERENCES `direction`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_downtime` ADD CONSTRAINT `fleet_downtime_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_downtime` ADD CONSTRAINT `fleet_downtime_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_downtime` ADD CONSTRAINT `fleet_downtime_importBatchId_fkey` FOREIGN KEY (`importBatchId`) REFERENCES `fleet_import_batch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_downtime` ADD CONSTRAINT `fleet_downtime_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `fleet_vehicle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_downtime` ADD CONSTRAINT `fleet_downtime_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_request` ADD CONSTRAINT `fleet_request_directionId_fkey` FOREIGN KEY (`directionId`) REFERENCES `direction`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_request` ADD CONSTRAINT `fleet_request_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_request` ADD CONSTRAINT `fleet_request_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_request` ADD CONSTRAINT `fleet_request_importBatchId_fkey` FOREIGN KEY (`importBatchId`) REFERENCES `fleet_import_batch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_request` ADD CONSTRAINT `fleet_request_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_request` ADD CONSTRAINT `fleet_request_targetDirectionId_fkey` FOREIGN KEY (`targetDirectionId`) REFERENCES `direction`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_request` ADD CONSTRAINT `fleet_request_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `site`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_request` ADD CONSTRAINT `fleet_request_initiatorId_fkey` FOREIGN KEY (`initiatorId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_request` ADD CONSTRAINT `fleet_request_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_snapshot` ADD CONSTRAINT `fleet_snapshot_directionId_fkey` FOREIGN KEY (`directionId`) REFERENCES `direction`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_snapshot` ADD CONSTRAINT `fleet_snapshot_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_snapshot` ADD CONSTRAINT `fleet_snapshot_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_snapshot` ADD CONSTRAINT `fleet_snapshot_importBatchId_fkey` FOREIGN KEY (`importBatchId`) REFERENCES `fleet_import_batch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_allocation` ADD CONSTRAINT `fleet_allocation_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `fleet_request`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_allocation` ADD CONSTRAINT `fleet_allocation_assignmentId_fkey` FOREIGN KEY (`assignmentId`) REFERENCES `fleet_assignment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_incident_liability` ADD CONSTRAINT `fleet_incident_liability_incidentId_fkey` FOREIGN KEY (`incidentId`) REFERENCES `fleet_incident`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_incident_liability` ADD CONSTRAINT `fleet_incident_liability_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_import_batch` ADD CONSTRAINT `fleet_import_batch_directionId_fkey` FOREIGN KEY (`directionId`) REFERENCES `direction`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fleet_import_batch` ADD CONSTRAINT `fleet_import_batch_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
