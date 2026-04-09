import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import Database from 'better-sqlite3';
import { schemaSql } from './schema';
import { seedDatabase } from './seed';

let dbInstance: Database.Database | null = null;

const ensureColumn = (db: Database.Database, table: string, column: string, definition: string) => {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  const exists = cols.some((c) => c.name === column);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
};

const ensureSettingDefault = (db: Database.Database, key: string, value: string) => {
  db.prepare(
    `INSERT INTO settings (key, value)
     VALUES (?, ?)
     ON CONFLICT(key) DO NOTHING`
  ).run(key, value);
};

const runMigrations = (db: Database.Database) => {
  ensureColumn(db, 'users', 'failed_login_attempts', 'failed_login_attempts INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'users', 'locked_until', 'locked_until TEXT');
  ensureColumn(db, 'users', 'last_login_at', 'last_login_at TEXT');
  ensureColumn(db, 'inventory_items', 'image_path', 'image_path TEXT');
  ensureColumn(db, 'inventory_items', 'supplier_id', 'supplier_id INTEGER');
  ensureColumn(db, 'inventory_items', 'item_discount_type', "item_discount_type TEXT NOT NULL DEFAULT 'NONE'");
  ensureColumn(db, 'inventory_items', 'item_discount_value', 'item_discount_value REAL NOT NULL DEFAULT 0');
  ensureColumn(db, 'inventory_items', 'pricing_method', "pricing_method TEXT NOT NULL DEFAULT 'MANUAL'");
  ensureColumn(db, 'inventory_items', 'profit_percentage_target', 'profit_percentage_target REAL NOT NULL DEFAULT 0');

  db.exec(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_person TEXT,
      phone TEXT,
      email TEXT,
      address TEXT,
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS supplier_spend_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
      inventory_item_id INTEGER REFERENCES inventory_items(id) ON DELETE SET NULL,
      purchase_date TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 0,
      unit_cost REAL NOT NULL DEFAULT 0,
      amount REAL NOT NULL,
      reference_no TEXT,
      notes TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_supplier_name ON suppliers (name);
    CREATE INDEX IF NOT EXISTS idx_supplier_spend_supplier_id ON supplier_spend_records (supplier_id);
  `);

  ensureSettingDefault(db, 'business_logo', '/branding/symbol-logo-main-jayakula.svg');
  ensureSettingDefault(db, 'brand_primary', '#FB1E2C');
  ensureSettingDefault(db, 'brand_secondary', '#00A7E6');
  ensureSettingDefault(db, 'sub_brand_name', 'Wiring Malli');
  ensureSettingDefault(db, 'sub_brand_logo', '');
  ensureSettingDefault(db, 'gdrive_client_id', '');
  ensureSettingDefault(db, 'gdrive_client_secret', '');
  ensureSettingDefault(db, 'gdrive_account_email', 'jayakulabrothers@gmail.com');
  ensureSettingDefault(db, 'gdrive_connected_email', '');
  ensureSettingDefault(db, 'gdrive_folder_id', '');
  ensureSettingDefault(db, 'gdrive_refresh_token', '');
  ensureSettingDefault(db, 'gdrive_last_backup_at', '');
  // Web stocks publishing (Drive-as-source for the GitHub Pages viewer)
  ensureSettingDefault(db, 'gdrive_stocks_file_id', '');
  ensureSettingDefault(db, 'gdrive_stocks_published_at', '');
  ensureSettingDefault(db, 'gdrive_stocks_auto_publish', '0');
};

export const getDatabasePath = () => {
  const userData = app.getPath('userData');
  return path.join(userData, 'localbiz.sqlite');
};

export const getDatabase = () => {
  if (dbInstance) {
    return dbInstance;
  }

  const dbPath = getDatabasePath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(schemaSql);
  seedDatabase(db);
  runMigrations(db);

  dbInstance = db;
  return db;
};

export const closeDatabase = () => {
  if (!dbInstance) return;
  dbInstance.close();
  dbInstance = null;
};
