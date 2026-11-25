-- AlterTable
ALTER TABLE `leave_requests` ADD COLUMN `decided_at` DATETIME(3) NULL,
    ADD COLUMN `document_id` CHAR(36) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `employee_documents_tenant_id_id_key` ON `employee_documents`(`tenant_id`, `id`);

-- AddForeignKey
ALTER TABLE `leave_requests` ADD CONSTRAINT `leave_requests_tenant_id_document_id_fkey` FOREIGN KEY (`tenant_id`, `document_id`) REFERENCES `employee_documents`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Guards -----------------------------------------------------------------------
-- The leave ledger is the balance (balance = SUM(quantity)). Entries are never edited or removed;
-- mistakes are fixed with a new ADJUSTMENT or REVERSAL entry.
CREATE TRIGGER leave_ledger_no_update BEFORE UPDATE ON leave_ledger_entries FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE: leave_ledger_entries is append-only';
CREATE TRIGGER leave_ledger_no_delete BEFORE DELETE ON leave_ledger_entries FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IMMUTABLE: leave_ledger_entries is append-only';

-- Requested quantities are whole or half days and never negative.
ALTER TABLE `leave_requests` ADD CONSTRAINT `leave_requests_quantity_chk` CHECK (`total_quantity` >= 0 AND `to_date` >= `from_date`);
ALTER TABLE `leave_request_days` ADD CONSTRAINT `leave_request_days_quantity_chk` CHECK (`quantity` > 0 AND `quantity` <= 1);
