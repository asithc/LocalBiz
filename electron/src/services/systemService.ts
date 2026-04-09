import fs from 'node:fs';
import path from 'node:path';
import { dialog, shell } from 'electron';
import type { Database } from 'better-sqlite3';
import { closeDatabase, getDatabasePath } from '../db';
import { settingsService } from './dataService';

const encode = encodeURIComponent;

export const backupDatabase = async () => {
  const dbPath = getDatabasePath();
  const result = await dialog.showSaveDialog({
    title: 'Backup Database',
    defaultPath: `localbiz-backup-${new Date().toISOString().slice(0, 10)}.sqlite`,
    filters: [{ name: 'SQLite Database', extensions: ['sqlite', 'db'] }]
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  fs.copyFileSync(dbPath, result.filePath);
  return { canceled: false, path: result.filePath };
};

export const restoreDatabase = async () => {
  const result = await dialog.showOpenDialog({
    title: 'Restore Database',
    properties: ['openFile'],
    filters: [{ name: 'SQLite Database', extensions: ['sqlite', 'db'] }]
  });

  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true };
  }

  closeDatabase();
  const dbPath = getDatabasePath();
  fs.copyFileSync(result.filePaths[0], dbPath);

  return { canceled: false, restoredFrom: result.filePaths[0] };
};

export const selectLogoFile = async () => {
  return selectImageFile('Select business logo');
};

export const selectImageFile = async (title = 'Select image') => {
  const result = await dialog.showOpenDialog({
    title,
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'svg', 'webp'] }]
  });

  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true };
  }

  return { canceled: false, filePath: result.filePaths[0] };
};

const getEstimateEmail = (db: Database, estimateId: number) => {
  const row = db
    .prepare(
      `SELECT
        e.estimate_number as estimateNumber,
        e.grand_total as total,
        e.issue_date as issueDate,
        c.name as customerName,
        c.email as customerEmail,
        c.phone as customerPhone
      FROM estimates e
      INNER JOIN customers c ON c.id = e.customer_id
      WHERE e.id = ?`
    )
    .get(estimateId) as any;

  if (!row) throw new Error('Estimate not found.');

  const subject = `Estimate ${row.estimateNumber} from our team`;
  const body = `Dear ${row.customerName},\n\nPlease find estimate ${row.estimateNumber} dated ${row.issueDate}.\nTotal: LKR ${Number(
    row.total
  ).toFixed(2)}\n\nPlease review and let us know your approval.\n\nRegards`; 

  return { to: row.customerEmail || '', subject, body };
};

const getInvoiceEmail = (db: Database, invoiceId: number) => {
  const row = db
    .prepare(
      `SELECT
        i.invoice_number as invoiceNumber,
        i.total,
        i.due_date as dueDate,
        c.name as customerName,
        c.email as customerEmail
      FROM invoices i
      INNER JOIN customers c ON c.id = i.customer_id
      WHERE i.id = ?`
    )
    .get(invoiceId) as any;

  if (!row) throw new Error('Invoice not found.');

  const subject = `Invoice ${row.invoiceNumber}`;
  const body = `Dear ${row.customerName},\n\nPlease find your invoice ${row.invoiceNumber}.\nTotal amount: LKR ${Number(
    row.total
  ).toFixed(2)}\nDue date: ${row.dueDate || 'N/A'}\n\nKindly complete payment at your earliest convenience.\n\nRegards`; 

  return { to: row.customerEmail || '', subject, body };
};

const getJobCompletionEmail = (db: Database, jobId: number) => {
  const row = db
    .prepare(
      `SELECT
        j.job_code as jobCode,
        j.title,
        c.name as customerName,
        c.email as customerEmail
      FROM jobs j
      INNER JOIN customers c ON c.id = j.customer_id
      WHERE j.id = ?`
    )
    .get(jobId) as any;

  if (!row) throw new Error('Job not found.');

  const subject = `Job ${row.jobCode} completed`;
  const body = `Dear ${row.customerName},\n\nThis is to confirm that job ${row.jobCode} (${row.title}) has been completed successfully.\n\nThank you for choosing us.\n\nRegards`;

  return { to: row.customerEmail || '', subject, body };
};

export const openMailComposer = async (
  db: Database,
  payload: { template: 'estimate' | 'invoice' | 'job'; id: number }
) => {
  const data =
    payload.template === 'estimate'
      ? getEstimateEmail(db, payload.id)
      : payload.template === 'invoice'
      ? getInvoiceEmail(db, payload.id)
      : getJobCompletionEmail(db, payload.id);

  const uri = `mailto:${encode(data.to)}?subject=${encode(data.subject)}&body=${encode(data.body)}`;
  await shell.openExternal(uri);
  return data;
};

export const buildBusinessDetails = (db: Database) => {
  const settings = settingsService.getAll(db);
  return {
    name: settings.business_name || 'Business Name',
    address: settings.business_address || '',
    phone: settings.business_phone || '',
    email: settings.business_email || '',
    logoPath: settings.business_logo || '/branding/symbol-logo-main-jayakula.svg',
    brandPrimary: settings.brand_primary || '#FB1E2C',
    brandSecondary: settings.brand_secondary || '#00A7E6',
    subBrandName: settings.sub_brand_name || 'Wiring Malli',
    subBrandLogoPath: settings.sub_brand_logo || ''
  };
};

export const copyLogoToDataDir = (filePath: string) => {
  return copyImageToDataDir(filePath);
};

export const copyImageToDataDir = (filePath: string) => {
  const fileName = path.basename(filePath);
  const targetDir = path.join(path.dirname(getDatabasePath()), 'assets');
  fs.mkdirSync(targetDir, { recursive: true });

  const targetPath = path.join(targetDir, fileName);
  fs.copyFileSync(filePath, targetPath);
  return targetPath;
};
