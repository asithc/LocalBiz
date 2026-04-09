import bcrypt from 'bcryptjs';
import type Database from 'better-sqlite3';
import { calculateTotals, nowIso } from './helpers';

export const seedDatabase = (db: Database.Database) => {
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  if (userCount.count > 0) {
    return;
  }

  const now = nowIso();
  const passwordHash = bcrypt.hashSync('admin123', 10);

  const insertUser = db.prepare(
    `INSERT INTO users (username, password_hash, role, must_change_password, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const adminInfo = insertUser.run('admin', passwordHash, 'Admin', 0, now, now);
  const staffUser1 = insertUser.run('kasun', bcrypt.hashSync('staff123', 10), 'Staff', 0, now, now);
  const staffUser2 = insertUser.run('nuwan', bcrypt.hashSync('staff123', 10), 'Staff', 0, now, now);

  const adminId = Number(adminInfo.lastInsertRowid);

  const insertCustomer = db.prepare(
    `INSERT INTO customers (name, phone, email, address, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const customerIds = [
    insertCustomer.run(
      'Ruwan Perera',
      '0711234567',
      'ruwan@example.com',
      'No 12, Galle Road, Colombo',
      'Apartment CCTV inquiry',
      now,
      now
    ).lastInsertRowid,
    insertCustomer.run(
      'Nadeesha Silva',
      '0779876543',
      'nadeesha@example.com',
      'Kandy Road, Kurunegala',
      'Office rewiring',
      now,
      now
    ).lastInsertRowid,
    insertCustomer.run(
      'Sunethra Stores',
      '0765551122',
      'sunethra@shop.lk',
      'Main Street, Negombo',
      'Shop camera maintenance',
      now,
      now
    ).lastInsertRowid
  ].map(Number);

  const insertSupplier = db.prepare(
    `INSERT INTO suppliers (name, contact_person, phone, email, address, notes, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const supplierIds = {
    cctvLanka: Number(
      insertSupplier.run(
        'CCTV Lanka',
        'Anjana Perera',
        '0114550011',
        'sales@cctvlanka.lk',
        'Nugegoda, Colombo',
        'CCTV distributor',
        1,
        now,
        now
      ).lastInsertRowid
    ),
    cableHouse: Number(
      insertSupplier.run(
        'Cable House',
        'Ravindu Silva',
        '0114667711',
        'orders@cablehouse.lk',
        'Panchikawatta, Colombo',
        'Network and cable supplier',
        1,
        now,
        now
      ).lastInsertRowid
    ),
    securityTech: Number(
      insertSupplier.run(
        'Security Tech',
        'Heshan Fernando',
        '0114889922',
        'info@securitytech.lk',
        'Kandy Road, Kadawatha',
        'DVR/NVR wholesaler',
        1,
        now,
        now
      ).lastInsertRowid
    ),
    powerSource: Number(
      insertSupplier.run(
        'Power Source',
        'Dinithi Amarasena',
        '0114775533',
        'support@powersource.lk',
        'Kiribathgoda',
        'Electrical accessories',
        1,
        now,
        now
      ).lastInsertRowid
    )
  };

  const insertItem = db.prepare(
    `INSERT INTO inventory_items (
      name, brand, category, sku, batch_number, serial_reference, image_path, is_serialized,
      unit_price, cost_price, selling_price, item_discount_type, item_discount_value, pricing_method, profit_percentage_target,
      quantity_in_stock, reorder_level, supplier_id,
      supplier_name, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const items = [
    {
      name: 'Dahua 2MP Dome Camera',
      brand: 'Dahua',
      category: 'CCTV',
      sku: 'CAM-DH-2MP',
      batch: 'B2026-01',
      serial: 'DH-SER-1001',
      serialized: 1,
      unit: 12500,
      cost: 9800,
      sell: 12500,
      qty: 8,
      reorder: 3,
      supplierId: supplierIds.cctvLanka,
      supplier: 'CCTV Lanka'
    },
    {
      name: 'Cat6 Cable (305m Box)',
      brand: 'NetLink',
      category: 'Cabling',
      sku: 'CBL-CAT6-305',
      batch: 'C2026-02',
      serial: '',
      serialized: 0,
      unit: 18500,
      cost: 15000,
      sell: 18500,
      qty: 12,
      reorder: 4,
      supplierId: supplierIds.cableHouse,
      supplier: 'Cable House'
    },
    {
      name: '8 Channel DVR',
      brand: 'Hikvision',
      category: 'CCTV',
      sku: 'DVR-HK-8CH',
      batch: 'D2026-03',
      serial: 'HK-DVR-8801',
      serialized: 1,
      unit: 42000,
      cost: 35500,
      sell: 42000,
      qty: 5,
      reorder: 2,
      supplierId: supplierIds.securityTech,
      supplier: 'Security Tech'
    },
    {
      name: '12V 10A Power Supply',
      brand: 'PowerMax',
      category: 'Accessories',
      sku: 'PSU-12V-10A',
      batch: 'P2026-01',
      serial: '',
      serialized: 0,
      unit: 6500,
      cost: 4900,
      sell: 6500,
      qty: 18,
      reorder: 6,
      supplierId: supplierIds.powerSource,
      supplier: 'Power Source'
    },
    {
      name: 'RJ45 Connector (Pack of 100)',
      brand: 'NetLink',
      category: 'Cabling',
      sku: 'RJ45-100',
      batch: 'R2026-05',
      serial: '',
      serialized: 0,
      unit: 1800,
      cost: 1200,
      sell: 1800,
      qty: 2,
      reorder: 5,
      supplierId: supplierIds.cableHouse,
      supplier: 'Cable House'
    }
  ];

  const itemIds: number[] = [];
  const insertMovement = db.prepare(
    `INSERT INTO inventory_movements (item_id, movement_type, quantity, reference_type, reference_id, notes, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  items.forEach((item) => {
    const inserted = insertItem.run(
      item.name,
      item.brand,
      item.category,
      item.sku,
      item.batch,
      item.serial,
      null,
      item.serialized,
      item.unit,
      item.cost,
      item.sell,
      'NONE',
      0,
      'MANUAL',
      0,
      item.qty,
      item.reorder,
      item.supplierId,
      item.supplier,
      'Seed data',
      now,
      now
    );
    const itemId = Number(inserted.lastInsertRowid);
    itemIds.push(itemId);

    insertMovement.run(itemId, 'IN', item.qty, 'SEED', 'seed', 'Initial stock', adminId, now);
  });

  const insertSupplierSpend = db.prepare(
    `INSERT INTO supplier_spend_records (
      supplier_id, inventory_item_id, purchase_date, quantity, unit_cost, amount, reference_no, notes, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  items.forEach((item, idx) => {
    const amount = item.qty * item.cost;
    insertSupplierSpend.run(
      item.supplierId,
      itemIds[idx],
      '2026-02-25',
      item.qty,
      item.cost,
      amount,
      `PO-2026-${String(idx + 1).padStart(3, '0')}`,
      `Seed purchase for ${item.name}`,
      adminId,
      now
    );
  });

  const insertStaff = db.prepare(
    `INSERT INTO staff (name, role_title, phone, email, monthly_salary, is_active, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const staffIds = [
    insertStaff.run('Kasun Fernando', 'Technician', '0719988776', 'kasun@localbiz.lk', 85000, 1, '', now, now)
      .lastInsertRowid,
    insertStaff.run('Nuwan Jayasinghe', 'Electrician', '0774455667', 'nuwan@localbiz.lk', 90000, 1, '', now, now)
      .lastInsertRowid
  ].map(Number);

  db.prepare(
    `INSERT INTO salary_records (staff_id, month, amount, is_paid, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(staffIds[0], '2026-03', 85000, 0, 'Pending March salary', now);

  const estimateNumber = 'EST-202603-0001';
  const estimateSubtotal = 12500 + 42000 + 35000;
  const estimateTotals = calculateTotals(estimateSubtotal, 'PERCENTAGE', 5);

  const estimateId = Number(
    db
      .prepare(
        `INSERT INTO estimates (
          estimate_number, customer_id, issue_date, status, discount_type, discount_value,
          subtotal, total_discount, grand_total, notes, terms, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        estimateNumber,
        customerIds[0],
        '2026-03-01',
        'Approved',
        'PERCENTAGE',
        5,
        estimateTotals.subtotal,
        estimateTotals.totalDiscount,
        estimateTotals.grandTotal,
        'Includes installation and basic training.',
        'Validity: 14 days. 50% advance required.',
        adminId,
        now,
        now
      ).lastInsertRowid
  );

  const insertEstimateItem = db.prepare(
    `INSERT INTO estimate_items (estimate_id, inventory_item_id, description, quantity, unit_price, discount, line_total)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  insertEstimateItem.run(estimateId, itemIds[0], 'Dahua 2MP Dome Camera', 1, 12500, 0, 12500);
  insertEstimateItem.run(estimateId, itemIds[2], '8 Channel DVR', 1, 42000, 0, 42000);
  insertEstimateItem.run(estimateId, null, 'Installation labor', 1, 35000, 0, 35000);

  const jobId = Number(
    db
      .prepare(
        `INSERT INTO jobs (
          job_code, customer_id, estimate_id, title, description, location, planned_start_date,
          planned_end_date, actual_completion_date, status, estimated_amount, labor_charges,
          extra_charges, final_adjustments, notes, internal_remarks, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'JOB-202603-0001',
        customerIds[0],
        estimateId,
        'Apartment CCTV Setup',
        'Install 4 camera setup with DVR and monitoring app.',
        'Colombo 06',
        '2026-03-05',
        '2026-03-07',
        '2026-03-07',
        'Completed',
        estimateTotals.grandTotal,
        35000,
        2500,
        0,
        'Job completed and tested.',
        'Customer requested extra cable concealment.',
        adminId,
        now,
        now
      ).lastInsertRowid
  );

  const insertJobItem = db.prepare(
    `INSERT INTO job_items (job_id, inventory_item_id, description, quantity, unit_price, line_total, allocated_from_stock)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  insertJobItem.run(jobId, itemIds[0], 'Dahua 2MP Dome Camera', 1, 12500, 12500, 1);
  insertJobItem.run(jobId, itemIds[2], '8 Channel DVR', 1, 42000, 42000, 1);
  insertJobItem.run(jobId, null, 'Installation labor', 1, 35000, 35000, 0);

  db.prepare('INSERT INTO job_staff (job_id, staff_id, assigned_at) VALUES (?, ?, ?)').run(jobId, staffIds[0], now);
  db.prepare('INSERT INTO job_staff (job_id, staff_id, assigned_at) VALUES (?, ?, ?)').run(jobId, staffIds[1], now);

  db.prepare('UPDATE inventory_items SET quantity_in_stock = quantity_in_stock - 1 WHERE id IN (?, ?)').run(itemIds[0], itemIds[2]);
  insertMovement.run(itemIds[0], 'ALLOCATE', -1, 'JOB', 'JOB-202603-0001', 'Allocated to sample job', adminId, now);
  insertMovement.run(itemIds[2], 'ALLOCATE', -1, 'JOB', 'JOB-202603-0001', 'Allocated to sample job', adminId, now);

  const invoiceSubtotal = 12500 + 42000 + 35000 + 2500;
  const invoiceTotals = calculateTotals(invoiceSubtotal, 'FIXED', 1000);

  const invoiceId = Number(
    db
      .prepare(
        `INSERT INTO invoices (
          invoice_number, customer_id, job_id, estimate_id, issue_date, due_date,
          discount_type, discount_value, subtotal, discount_amount, total,
          payment_status, payment_method, notes, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'INV-202603-0001',
        customerIds[0],
        jobId,
        estimateId,
        '2026-03-08',
        '2026-03-15',
        'FIXED',
        1000,
        invoiceTotals.subtotal,
        invoiceTotals.totalDiscount,
        invoiceTotals.grandTotal,
        'Partially Paid',
        'Bank Transfer',
        'Advance payment received.',
        adminId,
        now,
        now
      ).lastInsertRowid
  );

  const insertInvoiceItem = db.prepare(
    `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, line_total, source_type, source_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  insertInvoiceItem.run(invoiceId, 'Dahua 2MP Dome Camera', 1, 12500, 12500, 'JOB_ITEM', 1);
  insertInvoiceItem.run(invoiceId, '8 Channel DVR', 1, 42000, 42000, 'JOB_ITEM', 2);
  insertInvoiceItem.run(invoiceId, 'Installation labor', 1, 35000, 35000, 'SERVICE', null);
  insertInvoiceItem.run(invoiceId, 'Extra cable concealment', 1, 2500, 2500, 'SERVICE', null);

  const settingsStmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  [
    ['business_name', 'Jayakula Brothers Engineering'],
    ['business_address', 'No 77, Colombo Road, Sri Lanka'],
    ['business_phone', '+94 11 2345678'],
    ['business_email', 'info@jayakulabrothers.lk'],
    ['business_logo', '/branding/symbol-logo-main-jayakula.svg'],
    ['default_currency', 'LKR'],
    ['invoice_notes', 'Thank you for your business.'],
    ['estimate_notes', 'Quotation valid for 14 days.'],
    ['brand_primary', '#FB1E2C'],
    ['brand_secondary', '#00A7E6'],
    ['sub_brand_name', 'Wiring Malli'],
    ['sub_brand_logo', ''],
    ['gdrive_client_id', ''],
    ['gdrive_client_secret', ''],
    ['gdrive_account_email', 'jayakulabrothers@gmai.com'],
    ['gdrive_connected_email', ''],
    ['gdrive_folder_id', ''],
    ['gdrive_refresh_token', ''],
    ['gdrive_last_backup_at', ''],
    ['smtp_host', ''],
    ['smtp_port', ''],
    ['smtp_username', ''],
    ['smtp_password', '']
  ].forEach(([k, v]) => settingsStmt.run(k, v));

  const activity = db.prepare(
    `INSERT INTO activity_logs (action, entity_type, entity_id, description, performed_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  activity.run('CREATE', 'USER', String(adminId), 'Default admin user created', adminId, now);
  activity.run('CREATE', 'ESTIMATE', estimateNumber, 'Sample estimate created', adminId, now);
  activity.run('CREATE', 'JOB', 'JOB-202603-0001', 'Sample job created', adminId, now);
  activity.run('CREATE', 'INVOICE', 'INV-202603-0001', 'Sample invoice created', adminId, now);

  const _unused = [staffUser1, staffUser2];
  if (!_unused) {
    // never executed, placeholder to avoid lint complaints in strict linters
  }
};
