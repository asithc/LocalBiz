import type { Database } from 'better-sqlite3';
import type {
  Customer,
  DashboardStats,
  DiscountType,
  Estimate,
  ExportPayload,
  InventoryItem,
  Invoice,
  Job,
  Supplier,
  Staff
} from '../../../src/shared/types';
import { calculateTotals, nextCode, nowIso, round2 } from '../db/helpers';

const safeNum = (value: unknown) => Number(value || 0);
const clampPercent = (value: number) => Math.max(0, Math.min(100, value));

const calcDiscountAmount = (basePrice: number, discountType: DiscountType, discountValue: number) => {
  if (discountType === 'PERCENTAGE') return round2(basePrice * (clampPercent(discountValue) / 100));
  if (discountType === 'FIXED') return round2(Math.max(0, discountValue));
  return 0;
};

const getEffectiveSellingPrice = (basePrice: number, discountType: DiscountType, discountValue: number) => {
  const discount = calcDiscountAmount(basePrice, discountType, discountValue);
  return round2(Math.max(0, basePrice - discount));
};

const assertRequired = (value: unknown, label: string) => {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error(`${label} is required.`);
  }
};

const logActivity = (
  db: Database,
  action: string,
  entityType: string,
  entityId: string,
  description: string,
  performedBy?: number
) => {
  db.prepare(
    `INSERT INTO activity_logs (action, entity_type, entity_id, description, performed_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(action, entityType, entityId, description, performedBy ?? null, nowIso());
};

const getNextNumber = (db: Database, table: 'estimates' | 'jobs' | 'invoices', column: string, prefix: 'EST' | 'JOB' | 'INV') => {
  const latest = db
    .prepare(`SELECT ${column} as value FROM ${table} ORDER BY id DESC LIMIT 1`)
    .get() as { value?: string } | undefined;
  return nextCode(latest?.value, prefix);
};

const getEstimateItems = (db: Database, estimateId: number) =>
  db
    .prepare(
      `SELECT
        id,
        estimate_id as estimateId,
        inventory_item_id as inventoryItemId,
        description,
        quantity,
        unit_price as unitPrice,
        discount,
        line_total as lineTotal
      FROM estimate_items WHERE estimate_id = ?`
    )
    .all(estimateId);

const getJobItems = (db: Database, jobId: number) =>
  db
    .prepare(
      `SELECT
        id,
        job_id as jobId,
        inventory_item_id as inventoryItemId,
        description,
        quantity,
        unit_price as unitPrice,
        line_total as lineTotal,
        allocated_from_stock as allocatedFromStock
      FROM job_items WHERE job_id = ?`
    )
    .all(jobId);

const getInvoiceItems = (db: Database, invoiceId: number) =>
  db
    .prepare(
      `SELECT
        id,
        invoice_id as invoiceId,
        description,
        quantity,
        unit_price as unitPrice,
        line_total as lineTotal,
        source_type as sourceType,
        source_id as sourceId
      FROM invoice_items WHERE invoice_id = ?`
    )
    .all(invoiceId);

const buildRecentMonths = (count: number) => {
  const months: string[] = [];
  const base = new Date();
  base.setDate(1);
  for (let i = count - 1; i >= 0; i -= 1) {
    const monthDate = new Date(base.getFullYear(), base.getMonth() - i, 1);
    const monthKey = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;
    months.push(monthKey);
  }
  return months;
};

export const getDashboardStats = (db: Database): DashboardStats => {
  const totalInventoryItems =
    (db.prepare('SELECT COUNT(*) as count FROM inventory_items').get() as { count: number }).count ?? 0;
  const lowStockItems =
    (
      db
        .prepare('SELECT COUNT(*) as count FROM inventory_items WHERE quantity_in_stock <= reorder_level')
        .get() as { count: number }
    ).count ?? 0;
  const activeJobs =
    (
      db
        .prepare(
          "SELECT COUNT(*) as count FROM jobs WHERE status IN ('New', 'Scheduled', 'In Progress', 'On Hold')"
        )
        .get() as { count: number }
    ).count ?? 0;
  const pendingEstimates =
    (
      db
        .prepare("SELECT COUNT(*) as count FROM estimates WHERE status IN ('Draft', 'Sent')")
        .get() as { count: number }
    ).count ?? 0;
  const unpaidInvoices =
    (
      db
        .prepare("SELECT COUNT(*) as count FROM invoices WHERE payment_status IN ('Unpaid', 'Partially Paid')")
        .get() as { count: number }
    ).count ?? 0;

  const month = new Date().toISOString().slice(0, 7);
  const monthlyRevenue =
    (
      db
        .prepare("SELECT COALESCE(SUM(total), 0) as revenue FROM invoices WHERE issue_date LIKE ? AND payment_status <> 'Unpaid'")
        .get(`${month}%`) as { revenue: number }
    ).revenue ?? 0;

  const monthKeys = buildRecentMonths(12);
  const periodStart = `${monthKeys[0]}-01`;

  const revenueRows = db
    .prepare(
      `SELECT
        substr(issue_date, 1, 7) as month,
        COALESCE(SUM(total), 0) as amount
      FROM invoices
      WHERE issue_date >= ? AND payment_status <> 'Unpaid'
      GROUP BY substr(issue_date, 1, 7)`
    )
    .all(periodStart) as { month: string; amount: number }[];

  const spendRows = db
    .prepare(
      `SELECT
        substr(purchase_date, 1, 7) as month,
        COALESCE(SUM(amount), 0) as amount
      FROM supplier_spend_records
      WHERE purchase_date >= ?
      GROUP BY substr(purchase_date, 1, 7)`
    )
    .all(periodStart) as { month: string; amount: number }[];

  const revenueMap = new Map(revenueRows.map((row) => [row.month, round2(safeNum(row.amount))]));
  const spendMap = new Map(spendRows.map((row) => [row.month, round2(safeNum(row.amount))]));
  const monthlyTrend = monthKeys.map((monthKey) => {
    const revenue = revenueMap.get(monthKey) || 0;
    const spend = spendMap.get(monthKey) || 0;
    return {
      month: monthKey,
      revenue,
      spend,
      profit: round2(revenue - spend)
    };
  });

  const topGrossingItems = db
    .prepare(
      `SELECT
        COALESCE('INV-' || CAST(inv.id AS TEXT), 'CUSTOM-' || lower(trim(ii.description))) as itemKey,
        COALESCE(inv.name, ii.description) as itemName,
        COALESCE(SUM(ii.line_total), 0) as revenue,
        COALESCE(SUM(ii.quantity), 0) as quantity,
        COUNT(DISTINCT ii.invoice_id) as invoiceCount
      FROM invoice_items ii
      LEFT JOIN job_items ji ON ii.source_type = 'JOB_ITEM' AND ji.id = ii.source_id
      LEFT JOIN inventory_items inv ON ji.inventory_item_id = inv.id
      GROUP BY
        COALESCE('INV-' || CAST(inv.id AS TEXT), 'CUSTOM-' || lower(trim(ii.description))),
        COALESCE(inv.name, ii.description)
      HAVING trim(COALESCE(inv.name, ii.description, '')) <> ''
      ORDER BY revenue DESC
      LIMIT 5`
    )
    .all()
    .map((row: any) => ({
      itemKey: String(row.itemKey),
      itemName: String(row.itemName),
      revenue: round2(safeNum(row.revenue)),
      quantity: round2(safeNum(row.quantity)),
      invoiceCount: Number(row.invoiceCount || 0)
    }));

  const wiringLikeClause = `
    (
      lower(COALESCE(j.title, '')) LIKE '%wiring%' OR
      lower(COALESCE(j.title, '')) LIKE '%wire%' OR
      lower(COALESCE(j.title, '')) LIKE '%cable%' OR
      lower(COALESCE(j.title, '')) LIKE '%rewire%' OR
      lower(COALESCE(j.description, '')) LIKE '%wiring%' OR
      lower(COALESCE(j.description, '')) LIKE '%wire%' OR
      lower(COALESCE(j.description, '')) LIKE '%cable%' OR
      lower(COALESCE(j.description, '')) LIKE '%rewire%' OR
      lower(COALESCE(j.notes, '')) LIKE '%wiring%' OR
      lower(COALESCE(j.notes, '')) LIKE '%wire%' OR
      lower(COALESCE(j.notes, '')) LIKE '%cable%'
    )
  `;

  const wiringActiveJobs =
    (
      db
        .prepare(
          `SELECT COUNT(*) as count
          FROM jobs j
          WHERE ${wiringLikeClause} AND j.status IN ('New', 'Scheduled', 'In Progress', 'On Hold')`
        )
        .get() as { count: number }
    ).count ?? 0;

  const wiringCompletedThisMonth =
    (
      db
        .prepare(
          `SELECT COUNT(*) as count
          FROM jobs j
          WHERE ${wiringLikeClause} AND j.status = 'Completed'
            AND COALESCE(j.actual_completion_date, substr(j.updated_at, 1, 10)) LIKE ?`
        )
        .get(`${month}%`) as { count: number }
    ).count ?? 0;

  const wiringRevenueThisMonth =
    (
      db
        .prepare(
          `SELECT COALESCE(SUM(i.total), 0) as total
          FROM invoices i
          INNER JOIN jobs j ON j.id = i.job_id
          WHERE ${wiringLikeClause}
            AND i.issue_date LIKE ?
            AND i.payment_status <> 'Unpaid'`
        )
        .get(`${month}%`) as { total: number }
    ).total ?? 0;

  const avgWiringCompletedJobValue =
    (
      db
        .prepare(
          `SELECT COALESCE(AVG(i.total), 0) as avgValue
          FROM invoices i
          INNER JOIN jobs j ON j.id = i.job_id
          WHERE ${wiringLikeClause}
            AND j.status = 'Completed'
            AND i.payment_status <> 'Unpaid'`
        )
        .get() as { avgValue: number }
    ).avgValue ?? 0;

  const statusRows = db
    .prepare(
      `SELECT j.status as status, COUNT(*) as count
      FROM jobs j
      WHERE ${wiringLikeClause}
      GROUP BY j.status`
    )
    .all() as { status: string; count: number }[];

  const statusOrder = ['New', 'Scheduled', 'In Progress', 'On Hold', 'Completed', 'Cancelled'];
  const statusMap = new Map(statusRows.map((row) => [row.status, Number(row.count || 0)]));
  const statusBreakdown = statusOrder.map((status) => ({
    status,
    count: statusMap.get(status) || 0
  }));

  return {
    totalInventoryItems,
    lowStockItems,
    activeJobs,
    pendingEstimates,
    unpaidInvoices,
    monthlyRevenue: round2(monthlyRevenue),
    monthlyTrend,
    topGrossingItems,
    wiring: {
      activeJobs: wiringActiveJobs,
      completedThisMonth: wiringCompletedThisMonth,
      revenueThisMonth: round2(wiringRevenueThisMonth),
      averageCompletedJobValue: round2(avgWiringCompletedJobValue),
      statusBreakdown
    }
  };
};

export const listRecentActivity = (db: Database, limit = 25) =>
  db
    .prepare(
      `SELECT
        id,
        action,
        entity_type as entityType,
        entity_id as entityId,
        description,
        performed_by as performedBy,
        created_at as createdAt
      FROM activity_logs
      ORDER BY datetime(created_at) DESC
      LIMIT ?`
    )
    .all(limit);

export const inventoryService = {
  list(db: Database, search?: string) {
    const q = (search || '').trim();
    if (!q) {
      return db
        .prepare(
          `SELECT
            id,
            name,
            brand,
            category,
            sku,
            batch_number as batchNumber,
            serial_reference as serialReference,
            image_path as imagePath,
            is_serialized as isSerialized,
            unit_price as unitPrice,
            cost_price as costPrice,
            selling_price as sellingPrice,
            item_discount_type as itemDiscountType,
            item_discount_value as itemDiscountValue,
            pricing_method as pricingMethod,
            profit_percentage_target as profitPercentageTarget,
            (selling_price - (
              CASE
                WHEN item_discount_type = 'PERCENTAGE' THEN (selling_price * item_discount_value / 100.0)
                WHEN item_discount_type = 'FIXED' THEN item_discount_value
                ELSE 0
              END
            )) as effectiveSellingPrice,
            quantity_in_stock as quantityInStock,
            reorder_level as reorderLevel,
            supplier_id as supplierId,
            supplier_name as supplierName,
            notes,
            created_at as createdAt,
            updated_at as updatedAt
          FROM inventory_items
          ORDER BY datetime(updated_at) DESC`
        )
        .all() as InventoryItem[];
    }

    const pattern = `%${q}%`;
    return db
      .prepare(
        `SELECT
          id,
          name,
          brand,
          category,
          sku,
          batch_number as batchNumber,
          serial_reference as serialReference,
          image_path as imagePath,
          is_serialized as isSerialized,
          unit_price as unitPrice,
          cost_price as costPrice,
          selling_price as sellingPrice,
          item_discount_type as itemDiscountType,
          item_discount_value as itemDiscountValue,
          pricing_method as pricingMethod,
          profit_percentage_target as profitPercentageTarget,
          (selling_price - (
            CASE
              WHEN item_discount_type = 'PERCENTAGE' THEN (selling_price * item_discount_value / 100.0)
              WHEN item_discount_type = 'FIXED' THEN item_discount_value
              ELSE 0
            END
          )) as effectiveSellingPrice,
          quantity_in_stock as quantityInStock,
          reorder_level as reorderLevel,
          supplier_id as supplierId,
          supplier_name as supplierName,
          notes,
          created_at as createdAt,
          updated_at as updatedAt
        FROM inventory_items
        WHERE name LIKE ? OR brand LIKE ? OR sku LIKE ? OR category LIKE ? OR supplier_name LIKE ?
        ORDER BY datetime(updated_at) DESC`
      )
      .all(pattern, pattern, pattern, pattern, pattern) as InventoryItem[];
  },

  create(db: Database, payload: Partial<InventoryItem>, userId: number) {
    assertRequired(payload.name, 'Item name');
    assertRequired(payload.sku, 'SKU');
    if (safeNum(payload.quantityInStock) < 0) throw new Error('Quantity cannot be negative.');
    if (safeNum(payload.reorderLevel) < 0) throw new Error('Reorder level cannot be negative.');

    const now = nowIso();
    const supplierId = payload.supplierId ? Number(payload.supplierId) : null;
    let supplierName = payload.supplierName || null;
    const pricingMethod = payload.pricingMethod === 'PROFIT_PERCENTAGE' ? 'PROFIT_PERCENTAGE' : 'MANUAL';
    const costPrice = round2(safeNum(payload.costPrice));
    const profitPercentageTarget = round2(Math.max(0, safeNum(payload.profitPercentageTarget)));
    const sellingPrice =
      pricingMethod === 'PROFIT_PERCENTAGE'
        ? round2(costPrice + costPrice * (profitPercentageTarget / 100))
        : round2(safeNum(payload.sellingPrice));
    const itemDiscountType = (payload.itemDiscountType || 'NONE') as DiscountType;
    const itemDiscountValue = round2(Math.max(0, safeNum(payload.itemDiscountValue)));

    if (sellingPrice < 0) throw new Error('Selling price cannot be negative.');
    if (itemDiscountType === 'PERCENTAGE' && itemDiscountValue > 100) {
      throw new Error('Item discount percentage cannot exceed 100.');
    }
    if (itemDiscountType === 'FIXED' && itemDiscountValue > sellingPrice) {
      throw new Error('Item discount cannot exceed selling price.');
    }

    if (supplierId) {
      const supplier = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(supplierId) as { name: string } | undefined;
      if (!supplier) throw new Error('Selected supplier not found.');
      supplierName = supplier.name;
    }

    const res = db
      .prepare(
        `INSERT INTO inventory_items (
          name, brand, category, sku, batch_number, serial_reference, image_path, is_serialized,
          unit_price, cost_price, selling_price, item_discount_type, item_discount_value, pricing_method, profit_percentage_target,
          quantity_in_stock, reorder_level,
          supplier_id, supplier_name, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        String(payload.name).trim(),
        payload.brand || null,
        payload.category || null,
        String(payload.sku).trim(),
        payload.batchNumber || null,
        payload.serialReference || null,
        payload.imagePath || null,
        payload.isSerialized ? 1 : 0,
        safeNum(payload.unitPrice),
        costPrice,
        sellingPrice,
        itemDiscountType,
        itemDiscountValue,
        pricingMethod,
        profitPercentageTarget,
        safeNum(payload.quantityInStock),
        safeNum(payload.reorderLevel),
        supplierId,
        supplierName,
        payload.notes || null,
        now,
        now
      );

    const id = Number(res.lastInsertRowid);
    if (safeNum(payload.quantityInStock) > 0) {
      db.prepare(
        `INSERT INTO inventory_movements (item_id, movement_type, quantity, reference_type, reference_id, notes, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, 'IN', safeNum(payload.quantityInStock), 'MANUAL', null, 'Initial stock', userId, now);

      if (supplierId && safeNum(payload.costPrice) > 0) {
        db.prepare(
          `INSERT INTO supplier_spend_records (
            supplier_id, inventory_item_id, purchase_date, quantity, unit_cost, amount, reference_no, notes, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          supplierId,
          id,
          now.slice(0, 10),
          safeNum(payload.quantityInStock),
          costPrice,
          round2(safeNum(payload.quantityInStock) * costPrice),
          `INIT-${id}`,
          'Auto-recorded from initial stock entry',
          userId,
          now
        );
      }
    }

    logActivity(db, 'CREATE', 'INVENTORY', String(id), `Inventory item ${payload.name} created`, userId);
    return id;
  },

  update(db: Database, id: number, payload: Partial<InventoryItem>, userId: number) {
    const existing = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(id) as any;
    if (!existing) throw new Error('Inventory item not found.');

    assertRequired(payload.name, 'Item name');
    assertRequired(payload.sku, 'SKU');
    const supplierId = payload.supplierId ? Number(payload.supplierId) : null;
    let supplierName = payload.supplierName || null;
    const pricingMethod = payload.pricingMethod === 'PROFIT_PERCENTAGE' ? 'PROFIT_PERCENTAGE' : 'MANUAL';
    const costPrice = round2(safeNum(payload.costPrice));
    const profitPercentageTarget = round2(Math.max(0, safeNum(payload.profitPercentageTarget)));
    const sellingPrice =
      pricingMethod === 'PROFIT_PERCENTAGE'
        ? round2(costPrice + costPrice * (profitPercentageTarget / 100))
        : round2(safeNum(payload.sellingPrice));
    const itemDiscountType = (payload.itemDiscountType || 'NONE') as DiscountType;
    const itemDiscountValue = round2(Math.max(0, safeNum(payload.itemDiscountValue)));

    if (itemDiscountType === 'PERCENTAGE' && itemDiscountValue > 100) {
      throw new Error('Item discount percentage cannot exceed 100.');
    }
    if (itemDiscountType === 'FIXED' && itemDiscountValue > sellingPrice) {
      throw new Error('Item discount cannot exceed selling price.');
    }

    if (supplierId) {
      const supplier = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(supplierId) as { name: string } | undefined;
      if (!supplier) throw new Error('Selected supplier not found.');
      supplierName = supplier.name;
    }

    db.prepare(
      `UPDATE inventory_items SET
        name = ?,
        brand = ?,
        category = ?,
        sku = ?,
        batch_number = ?,
        serial_reference = ?,
        image_path = ?,
        is_serialized = ?,
        unit_price = ?,
        cost_price = ?,
        selling_price = ?,
        item_discount_type = ?,
        item_discount_value = ?,
        pricing_method = ?,
        profit_percentage_target = ?,
        reorder_level = ?,
        supplier_id = ?,
        supplier_name = ?,
        notes = ?,
        updated_at = ?
      WHERE id = ?`
    ).run(
      String(payload.name).trim(),
      payload.brand || null,
      payload.category || null,
      String(payload.sku).trim(),
      payload.batchNumber || null,
      payload.serialReference || null,
      payload.imagePath || null,
      payload.isSerialized ? 1 : 0,
      safeNum(payload.unitPrice),
      costPrice,
      sellingPrice,
      itemDiscountType,
      itemDiscountValue,
      pricingMethod,
      profitPercentageTarget,
      safeNum(payload.reorderLevel),
      supplierId,
      supplierName,
      payload.notes || null,
      nowIso(),
      id
    );

    logActivity(db, 'UPDATE', 'INVENTORY', String(id), `Inventory item ${payload.name} updated`, userId);
    return { ok: true };
  },

  delete(db: Database, id: number, userId: number) {
    const item = db.prepare('SELECT name FROM inventory_items WHERE id = ?').get(id) as { name: string } | undefined;
    if (!item) throw new Error('Inventory item not found.');

    db.prepare('DELETE FROM inventory_items WHERE id = ?').run(id);
    logActivity(db, 'DELETE', 'INVENTORY', String(id), `Inventory item ${item.name} deleted`, userId);
    return { ok: true };
  },

  movements(db: Database, itemId?: number) {
    if (itemId) {
      return db
        .prepare(
          `SELECT
            id,
            item_id as itemId,
            movement_type as movementType,
            quantity,
            reference_type as referenceType,
            reference_id as referenceId,
            notes,
            created_by as createdBy,
            created_at as createdAt
          FROM inventory_movements
          WHERE item_id = ?
          ORDER BY datetime(created_at) DESC`
        )
        .all(itemId);
    }

    return db
      .prepare(
        `SELECT
          id,
          item_id as itemId,
          movement_type as movementType,
          quantity,
          reference_type as referenceType,
          reference_id as referenceId,
          notes,
          created_by as createdBy,
          created_at as createdAt
        FROM inventory_movements
        ORDER BY datetime(created_at) DESC LIMIT 200`
      )
      .all();
  },

  adjustStock(db: Database, payload: { itemId: number; delta: number; notes?: string }, userId: number) {
    const { itemId, delta, notes } = payload;
    if (!delta) throw new Error('Adjustment amount is required.');

    const item = db
      .prepare('SELECT id, name, quantity_in_stock as quantityInStock FROM inventory_items WHERE id = ?')
      .get(itemId) as { id: number; name: string; quantityInStock: number } | undefined;

    if (!item) throw new Error('Inventory item not found.');

    const nextQty = round2(item.quantityInStock + safeNum(delta));
    if (nextQty < 0) throw new Error('Inventory cannot go negative.');

    db.prepare('UPDATE inventory_items SET quantity_in_stock = ?, updated_at = ? WHERE id = ?').run(nextQty, nowIso(), itemId);

    db.prepare(
      `INSERT INTO inventory_movements (item_id, movement_type, quantity, reference_type, reference_id, notes, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(itemId, 'ADJUSTMENT', safeNum(delta), 'MANUAL', null, notes || 'Manual stock adjustment', userId, nowIso());

    logActivity(db, 'ADJUST', 'INVENTORY', String(itemId), `Stock adjusted by ${delta} for ${item.name}`, userId);

    return { quantityInStock: nextQty };
  },

  allocateToJob(
    db: Database,
    payload: { jobId: number; inventoryItemId: number; quantity: number; unitPrice?: number },
    userId: number
  ) {
    const { jobId, inventoryItemId, quantity } = payload;
    const qty = safeNum(quantity);
    if (qty <= 0) throw new Error('Quantity must be greater than 0.');

    const item = db
      .prepare(
        `SELECT
          id,
          name,
          selling_price as sellingPrice,
          item_discount_type as itemDiscountType,
          item_discount_value as itemDiscountValue,
          quantity_in_stock as quantityInStock,
          is_serialized as isSerialized
         FROM inventory_items WHERE id = ?`
      )
      .get(inventoryItemId) as
      | {
          id: number;
          name: string;
          sellingPrice: number;
          itemDiscountType: DiscountType;
          itemDiscountValue: number;
          quantityInStock: number;
          isSerialized: number;
        }
      | undefined;

    if (!item) throw new Error('Inventory item not found.');
    if (item.isSerialized && qty !== 1) throw new Error('Serialized items must be allocated one at a time.');
    if (qty > item.quantityInStock) throw new Error('Cannot allocate more than available stock.');

    const defaultPrice = getEffectiveSellingPrice(item.sellingPrice, item.itemDiscountType || 'NONE', safeNum(item.itemDiscountValue));
    const unitPrice = payload.unitPrice ?? defaultPrice;
    const lineTotal = round2(unitPrice * qty);

    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO job_items (job_id, inventory_item_id, description, quantity, unit_price, line_total, allocated_from_stock)
         VALUES (?, ?, ?, ?, ?, ?, 1)`
      ).run(jobId, inventoryItemId, item.name, qty, unitPrice, lineTotal);

      db.prepare('UPDATE inventory_items SET quantity_in_stock = quantity_in_stock - ?, updated_at = ? WHERE id = ?').run(
        qty,
        nowIso(),
        inventoryItemId
      );

      db.prepare(
        `INSERT INTO inventory_movements (item_id, movement_type, quantity, reference_type, reference_id, notes, created_by, created_at)
         VALUES (?, 'ALLOCATE', ?, 'JOB', ?, ?, ?, ?)`
      ).run(inventoryItemId, -qty, String(jobId), `Allocated to job ${jobId}`, userId, nowIso());
    });

    tx();

    logActivity(db, 'ALLOCATE', 'JOB_ITEM', String(jobId), `${qty} x ${item.name} allocated to job ${jobId}`, userId);
    return { ok: true };
  },

  analytics(db: Database, payload?: { fromDate?: string; toDate?: string }) {
    const now = new Date();
    const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const fromDate = (payload?.fromDate || defaultFrom).slice(0, 10);
    const toDate = (payload?.toDate || now.toISOString().slice(0, 10)).slice(0, 10);

    const spendSummary = db
      .prepare(
        `SELECT
          COALESCE(SUM(amount), 0) as totalSpend,
          COUNT(*) as spendRecords
        FROM supplier_spend_records
        WHERE purchase_date BETWEEN ? AND ?`
      )
      .get(fromDate, toDate) as { totalSpend: number; spendRecords: number };

    const revenueRows = db
      .prepare(
        `SELECT
          ii.source_id as sourceId,
          ii.quantity as quantity,
          ii.unit_price as unitPrice,
          ii.line_total as lineTotal,
          ji.inventory_item_id as inventoryItemId
        FROM invoice_items ii
        INNER JOIN invoices inv ON inv.id = ii.invoice_id
        LEFT JOIN job_items ji ON ji.id = ii.source_id AND ii.source_type = 'JOB_ITEM'
        WHERE inv.issue_date BETWEEN ? AND ?`
      )
      .all(fromDate, toDate) as Array<{
      sourceId?: number;
      quantity: number;
      unitPrice: number;
      lineTotal: number;
      inventoryItemId?: number;
    }>;

    const itemMap = new Map<
      number,
      {
        itemId: number;
        itemName: string;
        quantitySold: number;
        revenue: number;
        cost: number;
        profit: number;
      }
    >();

    let inventoryRevenue = 0;
    let inventoryCost = 0;

    revenueRows.forEach((row) => {
      if (!row.inventoryItemId) return;

      const item = db
        .prepare(
          `SELECT
            id,
            name,
            cost_price as costPrice
          FROM inventory_items
          WHERE id = ?`
        )
        .get(row.inventoryItemId) as { id: number; name: string; costPrice: number } | undefined;
      if (!item) return;

      const qty = safeNum(row.quantity);
      const revenue = round2(safeNum(row.lineTotal));
      const cost = round2(qty * safeNum(item.costPrice));
      const profit = round2(revenue - cost);

      inventoryRevenue += revenue;
      inventoryCost += cost;

      const existing = itemMap.get(item.id);
      if (!existing) {
        itemMap.set(item.id, {
          itemId: item.id,
          itemName: item.name,
          quantitySold: qty,
          revenue,
          cost,
          profit
        });
      } else {
        existing.quantitySold = round2(existing.quantitySold + qty);
        existing.revenue = round2(existing.revenue + revenue);
        existing.cost = round2(existing.cost + cost);
        existing.profit = round2(existing.profit + profit);
      }
    });

    const byItem = Array.from(itemMap.values()).sort((a, b) => b.profit - a.profit);
    const inventoryProfit = round2(inventoryRevenue - inventoryCost);

    return {
      fromDate,
      toDate,
      totalSupplierSpend: round2(safeNum(spendSummary.totalSpend)),
      spendRecords: Number(spendSummary.spendRecords || 0),
      inventoryRevenue: round2(inventoryRevenue),
      inventoryCost: round2(inventoryCost),
      inventoryProfit,
      profitMarginPct: inventoryRevenue > 0 ? round2((inventoryProfit / inventoryRevenue) * 100) : 0,
      byItem
    };
  }
};

export const supplierService = {
  list(db: Database, search?: string) {
    const q = (search || '').trim();
    const where = q ? 'WHERE s.name LIKE ? OR s.contact_person LIKE ? OR s.phone LIKE ? OR s.email LIKE ? OR s.address LIKE ?' : '';
    const params = q ? Array(5).fill(`%${q}%`) : [];

    return db
      .prepare(
        `SELECT
          s.id,
          s.name,
          s.contact_person as contactPerson,
          s.phone,
          s.email,
          s.address,
          s.notes,
          s.is_active as isActive,
          s.created_at as createdAt,
          s.updated_at as updatedAt,
          COALESCE(SUM(ssr.amount), 0) as totalSpent,
          COUNT(ssr.id) as purchaseCount,
          MAX(ssr.purchase_date) as lastPurchaseDate,
          COUNT(DISTINCT i.id) as linkedItemCount
        FROM suppliers s
        LEFT JOIN supplier_spend_records ssr ON ssr.supplier_id = s.id
        LEFT JOIN inventory_items i ON i.supplier_id = s.id
        ${where}
        GROUP BY
          s.id,
          s.name,
          s.contact_person,
          s.phone,
          s.email,
          s.address,
          s.notes,
          s.is_active,
          s.created_at,
          s.updated_at
        ORDER BY datetime(s.updated_at) DESC`
      )
      .all(...params);
  },

  get(db: Database, id: number) {
    const supplier = db
      .prepare(
        `SELECT
          id,
          name,
          contact_person as contactPerson,
          phone,
          email,
          address,
          notes,
          is_active as isActive,
          created_at as createdAt,
          updated_at as updatedAt
        FROM suppliers
        WHERE id = ?`
      )
      .get(id) as Supplier | undefined;

    if (!supplier) throw new Error('Supplier not found.');

    const summary = db
      .prepare(
        `SELECT
          COUNT(*) as purchaseCount,
          COALESCE(SUM(amount), 0) as totalSpent,
          MAX(purchase_date) as lastPurchaseDate
        FROM supplier_spend_records
        WHERE supplier_id = ?`
      )
      .get(id);

    const spends = db
      .prepare(
        `SELECT
          ssr.id,
          ssr.supplier_id as supplierId,
          ssr.inventory_item_id as inventoryItemId,
          ii.name as itemName,
          ssr.purchase_date as purchaseDate,
          ssr.quantity,
          ssr.unit_cost as unitCost,
          ssr.amount,
          ssr.reference_no as referenceNo,
          ssr.notes,
          ssr.created_by as createdBy,
          ssr.created_at as createdAt
        FROM supplier_spend_records ssr
        LEFT JOIN inventory_items ii ON ii.id = ssr.inventory_item_id
        WHERE ssr.supplier_id = ?
        ORDER BY datetime(ssr.purchase_date) DESC, datetime(ssr.created_at) DESC`
      )
      .all(id);

    const items = db
      .prepare(
        `SELECT
          id,
          name,
          sku,
          category,
          quantity_in_stock as quantityInStock,
          cost_price as costPrice,
          selling_price as sellingPrice
        FROM inventory_items
        WHERE supplier_id = ?
        ORDER BY datetime(updated_at) DESC`
      )
      .all(id);

    return {
      supplier,
      summary: {
        purchaseCount: Number((summary as any)?.purchaseCount || 0),
        totalSpent: Number((summary as any)?.totalSpent || 0),
        lastPurchaseDate: (summary as any)?.lastPurchaseDate || null,
        linkedItemCount: items.length
      },
      spends,
      items
    };
  },

  create(db: Database, payload: Partial<Supplier>, userId: number) {
    assertRequired(payload.name, 'Supplier name');

    const res = db
      .prepare(
        `INSERT INTO suppliers (name, contact_person, phone, email, address, notes, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        String(payload.name).trim(),
        payload.contactPerson || null,
        payload.phone || null,
        payload.email || null,
        payload.address || null,
        payload.notes || null,
        payload.isActive ?? 1,
        nowIso(),
        nowIso()
      );

    const id = Number(res.lastInsertRowid);
    logActivity(db, 'CREATE', 'SUPPLIER', String(id), `Supplier ${payload.name} created`, userId);
    return id;
  },

  update(db: Database, id: number, payload: Partial<Supplier>, userId: number) {
    const existing = db.prepare('SELECT id FROM suppliers WHERE id = ?').get(id) as { id: number } | undefined;
    if (!existing) throw new Error('Supplier not found.');
    assertRequired(payload.name, 'Supplier name');

    db.prepare(
      `UPDATE suppliers SET
        name = ?,
        contact_person = ?,
        phone = ?,
        email = ?,
        address = ?,
        notes = ?,
        is_active = ?,
        updated_at = ?
      WHERE id = ?`
    ).run(
      String(payload.name).trim(),
      payload.contactPerson || null,
      payload.phone || null,
      payload.email || null,
      payload.address || null,
      payload.notes || null,
      payload.isActive ?? 1,
      nowIso(),
      id
    );

    db.prepare(
      'UPDATE inventory_items SET supplier_name = ?, updated_at = ? WHERE supplier_id = ?'
    ).run(String(payload.name).trim(), nowIso(), id);

    logActivity(db, 'UPDATE', 'SUPPLIER', String(id), `Supplier ${payload.name} updated`, userId);
    return { ok: true };
  },

  delete(db: Database, id: number, userId: number) {
    const supplier = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(id) as { name: string } | undefined;
    if (!supplier) throw new Error('Supplier not found.');

    const linkedItems = (db.prepare('SELECT COUNT(*) as count FROM inventory_items WHERE supplier_id = ?').get(id) as { count: number }).count;
    const spends = (db.prepare('SELECT COUNT(*) as count FROM supplier_spend_records WHERE supplier_id = ?').get(id) as { count: number }).count;
    if (linkedItems > 0 || spends > 0) {
      throw new Error('Cannot delete supplier with linked inventory items or spend records. Mark it inactive instead.');
    }

    db.prepare('DELETE FROM suppliers WHERE id = ?').run(id);
    logActivity(db, 'DELETE', 'SUPPLIER', String(id), `Supplier ${supplier.name} deleted`, userId);
    return { ok: true };
  },

  addSpend(
    db: Database,
    payload: {
      supplierId: number;
      inventoryItemId?: number;
      purchaseDate?: string;
      quantity?: number;
      unitCost?: number;
      amount?: number;
      referenceNo?: string;
      notes?: string;
    },
    userId: number
  ) {
    assertRequired(payload.supplierId, 'Supplier');
    const supplier = db.prepare('SELECT id, name FROM suppliers WHERE id = ?').get(payload.supplierId) as
      | { id: number; name: string }
      | undefined;
    if (!supplier) throw new Error('Supplier not found.');

    const quantity = safeNum(payload.quantity);
    const unitCost = safeNum(payload.unitCost);
    const calculated = quantity > 0 && unitCost > 0 ? round2(quantity * unitCost) : 0;
    const amount = safeNum(payload.amount) > 0 ? round2(safeNum(payload.amount)) : calculated;
    if (amount <= 0) throw new Error('Spend amount must be greater than 0.');

    if (payload.inventoryItemId) {
      const item = db
        .prepare('SELECT id, supplier_id as supplierId FROM inventory_items WHERE id = ?')
        .get(payload.inventoryItemId) as { id: number; supplierId?: number } | undefined;
      if (!item) throw new Error('Selected inventory item not found.');
      if (item.supplierId && Number(item.supplierId) !== Number(payload.supplierId)) {
        throw new Error('This inventory item is linked to a different supplier.');
      }

      db.prepare('UPDATE inventory_items SET supplier_id = ?, supplier_name = ?, updated_at = ? WHERE id = ?').run(
        payload.supplierId,
        supplier.name,
        nowIso(),
        payload.inventoryItemId
      );
    }

    const purchaseDate = payload.purchaseDate || new Date().toISOString().slice(0, 10);
    const res = db
      .prepare(
        `INSERT INTO supplier_spend_records (
          supplier_id, inventory_item_id, purchase_date, quantity, unit_cost, amount, reference_no, notes, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        payload.supplierId,
        payload.inventoryItemId || null,
        purchaseDate,
        quantity,
        unitCost,
        amount,
        payload.referenceNo || null,
        payload.notes || null,
        userId,
        nowIso()
      );

    const id = Number(res.lastInsertRowid);
    logActivity(db, 'CREATE', 'SUPPLIER_SPEND', String(id), `Spend recorded for supplier ${supplier.name}`, userId);
    return id;
  },

  deleteSpend(db: Database, payload: { supplierId: number; spendId: number }, userId: number) {
    const spend = db
      .prepare('SELECT id, supplier_id as supplierId FROM supplier_spend_records WHERE id = ?')
      .get(payload.spendId) as { id: number; supplierId: number } | undefined;
    if (!spend || spend.supplierId !== payload.supplierId) throw new Error('Spend record not found.');

    db.prepare('DELETE FROM supplier_spend_records WHERE id = ?').run(payload.spendId);
    logActivity(db, 'DELETE', 'SUPPLIER_SPEND', String(payload.spendId), `Supplier spend record deleted`, userId);
    return { ok: true };
  }
};

export const customerService = {
  list(db: Database, search?: string) {
    const q = (search || '').trim();
    if (!q) {
      return db
        .prepare(
          `SELECT
            c.id,
            c.name,
            c.phone,
            c.email,
            c.address,
            c.notes,
            c.created_at as createdAt,
            c.updated_at as updatedAt,
            COALESCE(est.estimate_count, 0) as estimateCount,
            COALESCE(inv.invoice_count, 0) as invoiceCount,
            COALESCE(inv.total_invoiced, 0) as totalInvoiced,
            COALESCE(inv.total_received, 0) as totalReceived,
            COALESCE(job.ongoing_job_count, 0) as ongoingJobCount
          FROM customers c
          LEFT JOIN (
            SELECT customer_id, COUNT(*) as estimate_count
            FROM estimates
            GROUP BY customer_id
          ) est ON est.customer_id = c.id
          LEFT JOIN (
            SELECT
              customer_id,
              COUNT(*) as invoice_count,
              COALESCE(SUM(total), 0) as total_invoiced,
              COALESCE(SUM(CASE WHEN payment_status <> 'Unpaid' THEN total ELSE 0 END), 0) as total_received
            FROM invoices
            GROUP BY customer_id
          ) inv ON inv.customer_id = c.id
          LEFT JOIN (
            SELECT customer_id, COUNT(*) as ongoing_job_count
            FROM jobs
            WHERE status IN ('New', 'Scheduled', 'In Progress', 'On Hold')
            GROUP BY customer_id
          ) job ON job.customer_id = c.id
          ORDER BY datetime(c.updated_at) DESC`
        )
        .all() as Customer[];
    }

    const pattern = `%${q}%`;
    return db
      .prepare(
        `SELECT
          c.id,
          c.name,
          c.phone,
          c.email,
          c.address,
          c.notes,
          c.created_at as createdAt,
          c.updated_at as updatedAt,
          COALESCE(est.estimate_count, 0) as estimateCount,
          COALESCE(inv.invoice_count, 0) as invoiceCount,
          COALESCE(inv.total_invoiced, 0) as totalInvoiced,
          COALESCE(inv.total_received, 0) as totalReceived,
          COALESCE(job.ongoing_job_count, 0) as ongoingJobCount
        FROM customers c
        LEFT JOIN (
          SELECT customer_id, COUNT(*) as estimate_count
          FROM estimates
          GROUP BY customer_id
        ) est ON est.customer_id = c.id
        LEFT JOIN (
          SELECT
            customer_id,
            COUNT(*) as invoice_count,
            COALESCE(SUM(total), 0) as total_invoiced,
            COALESCE(SUM(CASE WHEN payment_status <> 'Unpaid' THEN total ELSE 0 END), 0) as total_received
          FROM invoices
          GROUP BY customer_id
        ) inv ON inv.customer_id = c.id
        LEFT JOIN (
          SELECT customer_id, COUNT(*) as ongoing_job_count
          FROM jobs
          WHERE status IN ('New', 'Scheduled', 'In Progress', 'On Hold')
          GROUP BY customer_id
        ) job ON job.customer_id = c.id
        WHERE c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?
        ORDER BY datetime(c.updated_at) DESC`
      )
      .all(pattern, pattern, pattern) as Customer[];
  },

  create(db: Database, payload: Partial<Customer>, userId: number) {
    assertRequired(payload.name, 'Customer name');
    assertRequired(payload.phone, 'Phone number');

    const res = db
      .prepare(
        `INSERT INTO customers (name, phone, email, address, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        String(payload.name).trim(),
        String(payload.phone).trim(),
        payload.email || null,
        payload.address || null,
        payload.notes || null,
        nowIso(),
        nowIso()
      );

    const id = Number(res.lastInsertRowid);
    logActivity(db, 'CREATE', 'CUSTOMER', String(id), `Customer ${payload.name} created`, userId);
    return id;
  },

  update(db: Database, id: number, payload: Partial<Customer>, userId: number) {
    assertRequired(payload.name, 'Customer name');
    assertRequired(payload.phone, 'Phone number');

    db.prepare(
      `UPDATE customers SET name = ?, phone = ?, email = ?, address = ?, notes = ?, updated_at = ? WHERE id = ?`
    ).run(
      String(payload.name).trim(),
      String(payload.phone).trim(),
      payload.email || null,
      payload.address || null,
      payload.notes || null,
      nowIso(),
      id
    );

    logActivity(db, 'UPDATE', 'CUSTOMER', String(id), `Customer ${payload.name} updated`, userId);
    return { ok: true };
  },

  delete(db: Database, id: number, userId: number) {
    const row = db.prepare('SELECT name FROM customers WHERE id = ?').get(id) as { name: string } | undefined;
    if (!row) throw new Error('Customer not found.');

    db.prepare('DELETE FROM customers WHERE id = ?').run(id);
    logActivity(db, 'DELETE', 'CUSTOMER', String(id), `Customer ${row.name} deleted`, userId);
    return { ok: true };
  },

  insights(db: Database, customerId: number) {
    const customer = db
      .prepare(
        `SELECT id, name, phone, email, address, notes, created_at as createdAt, updated_at as updatedAt
         FROM customers
         WHERE id = ?`
      )
      .get(customerId) as Customer | undefined;

    if (!customer) throw new Error('Customer not found.');

    const summary = db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM estimates WHERE customer_id = @customerId) as estimateCount,
          (SELECT COUNT(*) FROM invoices WHERE customer_id = @customerId) as invoiceCount,
          (SELECT COALESCE(SUM(total), 0) FROM invoices WHERE customer_id = @customerId) as totalInvoiced,
          (SELECT COALESCE(SUM(CASE WHEN payment_status <> 'Unpaid' THEN total ELSE 0 END), 0) FROM invoices WHERE customer_id = @customerId) as totalReceived,
          (SELECT COUNT(*) FROM jobs WHERE customer_id = @customerId AND status IN ('New', 'Scheduled', 'In Progress', 'On Hold')) as ongoingJobCount,
          (SELECT COUNT(*) FROM jobs WHERE customer_id = @customerId AND status = 'Completed') as completedJobCount,
          (SELECT COUNT(DISTINCT js.staff_id)
             FROM job_staff js
             INNER JOIN jobs j ON j.id = js.job_id
            WHERE j.customer_id = @customerId
              AND j.status IN ('New', 'Scheduled', 'In Progress', 'On Hold')) as ongoingStaffCount`
      )
      .get({ customerId }) as Record<string, number>;

    const ongoingJobs = db
      .prepare(
        `SELECT
          j.id,
          j.job_code as jobCode,
          j.title,
          j.status,
          j.location,
          j.planned_start_date as plannedStartDate,
          j.planned_end_date as plannedEndDate,
          j.actual_completion_date as actualCompletionDate,
          COALESCE(GROUP_CONCAT(DISTINCT s.name), '') as staffNames,
          COUNT(DISTINCT js.staff_id) as staffCount
        FROM jobs j
        LEFT JOIN job_staff js ON js.job_id = j.id
        LEFT JOIN staff s ON s.id = js.staff_id
        WHERE j.customer_id = ?
          AND j.status IN ('New', 'Scheduled', 'In Progress', 'On Hold')
        GROUP BY
          j.id,
          j.job_code,
          j.title,
          j.status,
          j.location,
          j.planned_start_date,
          j.planned_end_date,
          j.actual_completion_date
        ORDER BY datetime(j.planned_start_date) DESC, datetime(j.updated_at) DESC`
      )
      .all(customerId);

    const recentEstimates = db
      .prepare(
        `SELECT
          id,
          estimate_number as estimateNumber,
          issue_date as issueDate,
          status,
          grand_total as grandTotal
        FROM estimates
        WHERE customer_id = ?
        ORDER BY datetime(created_at) DESC
        LIMIT 8`
      )
      .all(customerId);

    const recentInvoices = db
      .prepare(
        `SELECT
          id,
          invoice_number as invoiceNumber,
          issue_date as issueDate,
          payment_status as paymentStatus,
          total
        FROM invoices
        WHERE customer_id = ?
        ORDER BY datetime(created_at) DESC
        LIMIT 8`
      )
      .all(customerId);

    const timeline = db
      .prepare(
        `SELECT eventDate, eventType, reference, description
         FROM (
           SELECT
             j.created_at as eventDate,
             'JOB' as eventType,
             j.job_code as reference,
             'Job created: ' || j.title as description
           FROM jobs j
           WHERE j.customer_id = ?

           UNION ALL

           SELECT
             j.actual_completion_date as eventDate,
             'JOB' as eventType,
             j.job_code as reference,
             'Job marked completed' as description
           FROM jobs j
           WHERE j.customer_id = ? AND j.actual_completion_date IS NOT NULL

           UNION ALL

           SELECT
             e.created_at as eventDate,
             'ESTIMATE' as eventType,
             e.estimate_number as reference,
             'Estimate ' || e.status || ' (' || printf('%.2f', e.grand_total) || ' LKR)' as description
           FROM estimates e
           WHERE e.customer_id = ?

           UNION ALL

           SELECT
             i.created_at as eventDate,
             'INVOICE' as eventType,
             i.invoice_number as reference,
             'Invoice ' || i.payment_status || ' (' || printf('%.2f', i.total) || ' LKR)' as description
           FROM invoices i
           WHERE i.customer_id = ?

           UNION ALL

           SELECT
             al.created_at as eventDate,
             'JOB_ACTIVITY' as eventType,
             al.entity_id as reference,
             al.description as description
           FROM activity_logs al
           INNER JOIN jobs j
             ON (al.entity_id = j.job_code OR al.entity_id = CAST(j.id AS TEXT))
           WHERE j.customer_id = ?
             AND al.entity_type = 'JOB'
         )
         WHERE eventDate IS NOT NULL
         ORDER BY datetime(eventDate) DESC
         LIMIT 60`
      )
      .all(customerId, customerId, customerId, customerId, customerId);

    return {
      customer,
      summary,
      ongoingJobs,
      recentEstimates,
      recentInvoices,
      timeline
    };
  }
};

export const estimateService = {
  list(db: Database, search?: string, status?: string) {
    const clauses: string[] = [];
    const params: any[] = [];

    if (search?.trim()) {
      clauses.push('(e.estimate_number LIKE ? OR c.name LIKE ?)');
      const p = `%${search.trim()}%`;
      params.push(p, p);
    }

    if (status && status !== 'ALL') {
      clauses.push('e.status = ?');
      params.push(status);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return db
      .prepare(
        `SELECT
          e.id,
          e.estimate_number as estimateNumber,
          e.customer_id as customerId,
          c.name as customerName,
          e.issue_date as issueDate,
          e.status,
          e.discount_type as discountType,
          e.discount_value as discountValue,
          e.subtotal,
          e.total_discount as totalDiscount,
          e.grand_total as grandTotal,
          e.notes,
          e.terms,
          e.created_by as createdBy,
          e.created_at as createdAt,
          e.updated_at as updatedAt
        FROM estimates e
        INNER JOIN customers c ON c.id = e.customer_id
        ${where}
        ORDER BY datetime(e.created_at) DESC`
      )
      .all(...params);
  },

  get(db: Database, id: number) {
    const estimate = db
      .prepare(
        `SELECT
          e.id,
          e.estimate_number as estimateNumber,
          e.customer_id as customerId,
          c.name as customerName,
          c.phone as customerPhone,
          c.email as customerEmail,
          c.address as customerAddress,
          e.issue_date as issueDate,
          e.status,
          e.discount_type as discountType,
          e.discount_value as discountValue,
          e.subtotal,
          e.total_discount as totalDiscount,
          e.grand_total as grandTotal,
          e.notes,
          e.terms,
          e.created_by as createdBy,
          e.created_at as createdAt,
          e.updated_at as updatedAt
        FROM estimates e
        INNER JOIN customers c ON c.id = e.customer_id
        WHERE e.id = ?`
      )
      .get(id) as Record<string, unknown> | undefined;

    if (!estimate) throw new Error('Estimate not found.');

    return {
      ...estimate,
      items: getEstimateItems(db, id)
    };
  },

  create(
    db: Database,
    payload: {
      customerId: number;
      issueDate: string;
      status: Estimate['status'];
      discountType: DiscountType;
      discountValue: number;
      notes?: string;
      terms?: string;
      items: Array<{
        inventoryItemId?: number;
        description: string;
        quantity: number;
        unitPrice: number;
        discount?: number;
      }>;
    },
    userId: number
  ) {
    assertRequired(payload.customerId, 'Customer');
    if (!payload.items?.length) throw new Error('At least one line item is required.');

    const subtotal = round2(
      payload.items.reduce((sum, item) => sum + safeNum(item.quantity) * safeNum(item.unitPrice) - safeNum(item.discount), 0)
    );

    const totals = calculateTotals(subtotal, payload.discountType, safeNum(payload.discountValue));

    const tx = db.transaction(() => {
      const estimateNumber = getNextNumber(db, 'estimates', 'estimate_number', 'EST');
      const res = db
        .prepare(
          `INSERT INTO estimates (
            estimate_number, customer_id, issue_date, status, discount_type, discount_value,
            subtotal, total_discount, grand_total, notes, terms, created_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          estimateNumber,
          payload.customerId,
          payload.issueDate || new Date().toISOString().slice(0, 10),
          payload.status || 'Draft',
          payload.discountType || 'NONE',
          safeNum(payload.discountValue),
          totals.subtotal,
          totals.totalDiscount,
          totals.grandTotal,
          payload.notes || null,
          payload.terms || null,
          userId,
          nowIso(),
          nowIso()
        );

      const estimateId = Number(res.lastInsertRowid);
      const insertItem = db.prepare(
        `INSERT INTO estimate_items (estimate_id, inventory_item_id, description, quantity, unit_price, discount, line_total)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );

      payload.items.forEach((item) => {
        assertRequired(item.description, 'Item description');
        if (safeNum(item.quantity) <= 0) throw new Error('Item quantity must be greater than 0.');
        if (safeNum(item.unitPrice) < 0) throw new Error('Unit price cannot be negative.');

        const lineTotal = round2(safeNum(item.quantity) * safeNum(item.unitPrice) - safeNum(item.discount));
        if (lineTotal < 0) throw new Error('Invalid item discount.');

        insertItem.run(
          estimateId,
          item.inventoryItemId || null,
          item.description,
          safeNum(item.quantity),
          safeNum(item.unitPrice),
          safeNum(item.discount),
          lineTotal
        );
      });

      logActivity(db, 'CREATE', 'ESTIMATE', estimateNumber, `Estimate ${estimateNumber} created`, userId);
      return { estimateId, estimateNumber };
    });

    return tx();
  },

  update(
    db: Database,
    estimateId: number,
    payload: {
      customerId: number;
      issueDate: string;
      status: Estimate['status'];
      discountType: DiscountType;
      discountValue: number;
      notes?: string;
      terms?: string;
      items: Array<{
        inventoryItemId?: number;
        description: string;
        quantity: number;
        unitPrice: number;
        discount?: number;
      }>;
    },
    userId: number
  ) {
    const estimate = db.prepare('SELECT estimate_number as estimateNumber FROM estimates WHERE id = ?').get(estimateId) as
      | { estimateNumber: string }
      | undefined;

    if (!estimate) throw new Error('Estimate not found.');

    if (!payload.items.length) throw new Error('At least one line item is required.');

    const subtotal = round2(
      payload.items.reduce((sum, item) => sum + safeNum(item.quantity) * safeNum(item.unitPrice) - safeNum(item.discount), 0)
    );

    const totals = calculateTotals(subtotal, payload.discountType, safeNum(payload.discountValue));

    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE estimates SET
          customer_id = ?,
          issue_date = ?,
          status = ?,
          discount_type = ?,
          discount_value = ?,
          subtotal = ?,
          total_discount = ?,
          grand_total = ?,
          notes = ?,
          terms = ?,
          updated_at = ?
        WHERE id = ?`
      ).run(
        payload.customerId,
        payload.issueDate,
        payload.status,
        payload.discountType,
        safeNum(payload.discountValue),
        totals.subtotal,
        totals.totalDiscount,
        totals.grandTotal,
        payload.notes || null,
        payload.terms || null,
        nowIso(),
        estimateId
      );

      db.prepare('DELETE FROM estimate_items WHERE estimate_id = ?').run(estimateId);
      const insertItem = db.prepare(
        `INSERT INTO estimate_items (estimate_id, inventory_item_id, description, quantity, unit_price, discount, line_total)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );

      payload.items.forEach((item) => {
        const lineTotal = round2(safeNum(item.quantity) * safeNum(item.unitPrice) - safeNum(item.discount));
        if (lineTotal < 0) throw new Error('Invalid item discount.');

        insertItem.run(
          estimateId,
          item.inventoryItemId || null,
          item.description,
          safeNum(item.quantity),
          safeNum(item.unitPrice),
          safeNum(item.discount),
          lineTotal
        );
      });

      logActivity(db, 'UPDATE', 'ESTIMATE', estimate.estimateNumber, `Estimate ${estimate.estimateNumber} updated`, userId);
    });

    tx();
    return { ok: true };
  },

  updateStatus(db: Database, estimateId: number, status: Estimate['status'], userId: number) {
    db.prepare('UPDATE estimates SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), estimateId);
    const estimate = db
      .prepare('SELECT estimate_number as estimateNumber FROM estimates WHERE id = ?')
      .get(estimateId) as { estimateNumber: string };
    logActivity(db, 'STATUS', 'ESTIMATE', estimate.estimateNumber, `Estimate ${estimate.estimateNumber} status ${status}`, userId);
    return { ok: true };
  },

  delete(db: Database, estimateId: number, userId: number) {
    const estimate = db
      .prepare('SELECT estimate_number as estimateNumber FROM estimates WHERE id = ?')
      .get(estimateId) as { estimateNumber: string } | undefined;

    if (!estimate) throw new Error('Estimate not found.');

    db.prepare('DELETE FROM estimates WHERE id = ?').run(estimateId);
    logActivity(db, 'DELETE', 'ESTIMATE', estimate.estimateNumber, `Estimate ${estimate.estimateNumber} deleted`, userId);
    return { ok: true };
  },

  convertToJob(db: Database, estimateId: number, payload: { title?: string; location?: string }, userId: number) {
    const estimate = estimateService.get(db, estimateId) as any;
    if (estimate.status !== 'Approved' && estimate.status !== 'Converted') {
      throw new Error('Only approved estimates can be converted to jobs.');
    }

    const exists = db.prepare('SELECT id, job_code as jobCode FROM jobs WHERE estimate_id = ?').get(estimateId) as
      | { id: number; jobCode: string }
      | undefined;
    if (exists) {
      return { jobId: exists.id, jobCode: exists.jobCode, alreadyExists: true };
    }

    const tx = db.transaction(() => {
      const jobCode = getNextNumber(db, 'jobs', 'job_code', 'JOB');

      const jobRes = db
        .prepare(
          `INSERT INTO jobs (
            job_code, customer_id, estimate_id, title, description, location,
            status, estimated_amount, labor_charges, extra_charges, final_adjustments,
            notes, internal_remarks, created_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          jobCode,
          estimate.customerId,
          estimateId,
          payload.title || `Job for ${estimate.estimateNumber}`,
          `Converted from estimate ${estimate.estimateNumber}`,
          payload.location || estimate.customerAddress || null,
          'New',
          safeNum(estimate.grandTotal),
          0,
          0,
          0,
          estimate.notes || null,
          null,
          userId,
          nowIso(),
          nowIso()
        );

      const jobId = Number(jobRes.lastInsertRowid);
      const insertJobItem = db.prepare(
        `INSERT INTO job_items (job_id, inventory_item_id, description, quantity, unit_price, line_total, allocated_from_stock)
         VALUES (?, ?, ?, ?, ?, ?, 0)`
      );

      (estimate.items as any[]).forEach((item) => {
        insertJobItem.run(
          jobId,
          item.inventoryItemId || null,
          item.description,
          safeNum(item.quantity),
          safeNum(item.unitPrice),
          safeNum(item.lineTotal)
        );
      });

      db.prepare('UPDATE estimates SET status = ?, updated_at = ? WHERE id = ?').run('Converted', nowIso(), estimateId);

      logActivity(db, 'CONVERT', 'ESTIMATE', estimate.estimateNumber, `Converted ${estimate.estimateNumber} to ${jobCode}`, userId);
      return { jobId, jobCode };
    });

    return tx();
  }
};

export const jobService = {
  list(db: Database, search?: string, status?: string) {
    const clauses: string[] = [];
    const params: any[] = [];
    if (search?.trim()) {
      clauses.push('(j.job_code LIKE ? OR j.title LIKE ? OR c.name LIKE ?)');
      const p = `%${search.trim()}%`;
      params.push(p, p, p);
    }
    if (status && status !== 'ALL') {
      clauses.push('j.status = ?');
      params.push(status);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    return db
      .prepare(
        `SELECT
          j.id,
          j.job_code as jobCode,
          j.customer_id as customerId,
          c.name as customerName,
          j.estimate_id as estimateId,
          j.title,
          j.description,
          j.location,
          j.planned_start_date as plannedStartDate,
          j.planned_end_date as plannedEndDate,
          j.actual_completion_date as actualCompletionDate,
          j.status,
          j.estimated_amount as estimatedAmount,
          j.labor_charges as laborCharges,
          j.extra_charges as extraCharges,
          j.final_adjustments as finalAdjustments,
          j.notes,
          j.internal_remarks as internalRemarks,
          j.created_by as createdBy,
          j.created_at as createdAt,
          j.updated_at as updatedAt
        FROM jobs j
        INNER JOIN customers c ON c.id = j.customer_id
        ${where}
        ORDER BY datetime(j.created_at) DESC`
      )
      .all(...params);
  },

  get(db: Database, jobId: number) {
    const job = db
      .prepare(
        `SELECT
          j.id,
          j.job_code as jobCode,
          j.customer_id as customerId,
          c.name as customerName,
          c.phone as customerPhone,
          c.email as customerEmail,
          c.address as customerAddress,
          j.estimate_id as estimateId,
          j.title,
          j.description,
          j.location,
          j.planned_start_date as plannedStartDate,
          j.planned_end_date as plannedEndDate,
          j.actual_completion_date as actualCompletionDate,
          j.status,
          j.estimated_amount as estimatedAmount,
          j.labor_charges as laborCharges,
          j.extra_charges as extraCharges,
          j.final_adjustments as finalAdjustments,
          j.notes,
          j.internal_remarks as internalRemarks,
          j.created_by as createdBy,
          j.created_at as createdAt,
          j.updated_at as updatedAt
        FROM jobs j
        INNER JOIN customers c ON c.id = j.customer_id
        WHERE j.id = ?`
      )
      .get(jobId) as Record<string, unknown> | undefined;

    if (!job) throw new Error('Job not found.');

    const staff = db
      .prepare(
        `SELECT s.id, s.name, s.role_title as roleTitle
         FROM job_staff js
         INNER JOIN staff s ON s.id = js.staff_id
         WHERE js.job_id = ?`
      )
      .all(jobId);

    return {
      ...job,
      items: getJobItems(db, jobId),
      staff
    };
  },

  create(
    db: Database,
    payload: Partial<Job> & { staffIds?: number[]; items?: any[] },
    userId: number
  ) {
    assertRequired(payload.customerId, 'Customer');
    assertRequired(payload.title, 'Job title');

    const code = getNextNumber(db, 'jobs', 'job_code', 'JOB');
    const tx = db.transaction(() => {
      const res = db
        .prepare(
          `INSERT INTO jobs (
            job_code, customer_id, estimate_id, title, description, location,
            planned_start_date, planned_end_date, actual_completion_date,
            status, estimated_amount, labor_charges, extra_charges, final_adjustments,
            notes, internal_remarks, created_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          code,
          payload.customerId,
          payload.estimateId || null,
          payload.title,
          payload.description || null,
          payload.location || null,
          payload.plannedStartDate || null,
          payload.plannedEndDate || null,
          payload.actualCompletionDate || null,
          payload.status || 'New',
          safeNum(payload.estimatedAmount),
          safeNum(payload.laborCharges),
          safeNum(payload.extraCharges),
          safeNum(payload.finalAdjustments),
          payload.notes || null,
          payload.internalRemarks || null,
          userId,
          nowIso(),
          nowIso()
        );

      const jobId = Number(res.lastInsertRowid);
      const insertStaff = db.prepare('INSERT INTO job_staff (job_id, staff_id, assigned_at) VALUES (?, ?, ?)');
      (payload.staffIds || []).forEach((staffId) => insertStaff.run(jobId, staffId, nowIso()));

      if (payload.items?.length) {
        const insertItem = db.prepare(
          `INSERT INTO job_items (job_id, inventory_item_id, description, quantity, unit_price, line_total, allocated_from_stock)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        );
        payload.items.forEach((item) => {
          insertItem.run(
            jobId,
            item.inventoryItemId || null,
            item.description,
            safeNum(item.quantity),
            safeNum(item.unitPrice),
            round2(safeNum(item.quantity) * safeNum(item.unitPrice)),
            item.allocatedFromStock ? 1 : 0
          );
        });
      }

      logActivity(db, 'CREATE', 'JOB', code, `Job ${code} created`, userId);
      return { jobId, jobCode: code };
    });

    return tx();
  },

  update(db: Database, jobId: number, payload: Partial<Job> & { staffIds?: number[] }, userId: number) {
    const existing = db.prepare('SELECT job_code as jobCode FROM jobs WHERE id = ?').get(jobId) as { jobCode: string } | undefined;
    if (!existing) throw new Error('Job not found.');

    assertRequired(payload.customerId, 'Customer');
    assertRequired(payload.title, 'Job title');

    db.prepare(
      `UPDATE jobs SET
        customer_id = ?,
        estimate_id = ?,
        title = ?,
        description = ?,
        location = ?,
        planned_start_date = ?,
        planned_end_date = ?,
        actual_completion_date = ?,
        status = ?,
        estimated_amount = ?,
        labor_charges = ?,
        extra_charges = ?,
        final_adjustments = ?,
        notes = ?,
        internal_remarks = ?,
        updated_at = ?
      WHERE id = ?`
    ).run(
      payload.customerId,
      payload.estimateId || null,
      payload.title,
      payload.description || null,
      payload.location || null,
      payload.plannedStartDate || null,
      payload.plannedEndDate || null,
      payload.actualCompletionDate || null,
      payload.status || 'New',
      safeNum(payload.estimatedAmount),
      safeNum(payload.laborCharges),
      safeNum(payload.extraCharges),
      safeNum(payload.finalAdjustments),
      payload.notes || null,
      payload.internalRemarks || null,
      nowIso(),
      jobId
    );

    if (payload.staffIds) {
      db.prepare('DELETE FROM job_staff WHERE job_id = ?').run(jobId);
      const insertStaff = db.prepare('INSERT INTO job_staff (job_id, staff_id, assigned_at) VALUES (?, ?, ?)');
      payload.staffIds.forEach((staffId) => insertStaff.run(jobId, staffId, nowIso()));
    }

    logActivity(db, 'UPDATE', 'JOB', existing.jobCode, `Job ${existing.jobCode} updated`, userId);
    return { ok: true };
  },

  delete(db: Database, jobId: number, userId: number) {
    const job = db.prepare('SELECT job_code as jobCode FROM jobs WHERE id = ?').get(jobId) as { jobCode: string } | undefined;
    if (!job) throw new Error('Job not found.');

    const items = db
      .prepare(
        `SELECT inventory_item_id as inventoryItemId, quantity, allocated_from_stock as allocatedFromStock
         FROM job_items WHERE job_id = ?`
      )
      .all(jobId) as Array<{ inventoryItemId?: number; quantity: number; allocatedFromStock: number }>;

    const tx = db.transaction(() => {
      items.forEach((item) => {
        if (item.allocatedFromStock && item.inventoryItemId) {
          db.prepare('UPDATE inventory_items SET quantity_in_stock = quantity_in_stock + ?, updated_at = ? WHERE id = ?').run(
            item.quantity,
            nowIso(),
            item.inventoryItemId
          );
          db.prepare(
            `INSERT INTO inventory_movements (item_id, movement_type, quantity, reference_type, reference_id, notes, created_by, created_at)
             VALUES (?, 'RESTORE', ?, 'JOB', ?, ?, ?, ?)`
          ).run(item.inventoryItemId, item.quantity, String(jobId), 'Stock restored from deleted job', userId, nowIso());
        }
      });

      db.prepare('DELETE FROM jobs WHERE id = ?').run(jobId);
    });

    tx();
    logActivity(db, 'DELETE', 'JOB', job.jobCode, `Job ${job.jobCode} deleted`, userId);
    return { ok: true };
  },

  addServiceItem(
    db: Database,
    payload: { jobId: number; description: string; quantity: number; unitPrice: number },
    userId: number
  ) {
    assertRequired(payload.description, 'Description');
    if (safeNum(payload.quantity) <= 0) throw new Error('Quantity must be greater than 0.');
    if (safeNum(payload.unitPrice) < 0) throw new Error('Unit price cannot be negative.');

    db.prepare(
      `INSERT INTO job_items (job_id, inventory_item_id, description, quantity, unit_price, line_total, allocated_from_stock)
       VALUES (?, NULL, ?, ?, ?, ?, 0)`
    ).run(
      payload.jobId,
      payload.description,
      safeNum(payload.quantity),
      safeNum(payload.unitPrice),
      round2(safeNum(payload.quantity) * safeNum(payload.unitPrice))
    );

    logActivity(db, 'ADD_ITEM', 'JOB', String(payload.jobId), `Service item added to job ${payload.jobId}`, userId);
    return { ok: true };
  },

  removeItem(db: Database, payload: { jobId: number; jobItemId: number }, userId: number) {
    const item = db
      .prepare(
        `SELECT id, inventory_item_id as inventoryItemId, quantity, allocated_from_stock as allocatedFromStock
         FROM job_items WHERE id = ? AND job_id = ?`
      )
      .get(payload.jobItemId, payload.jobId) as
      | { id: number; inventoryItemId?: number; quantity: number; allocatedFromStock: number }
      | undefined;

    if (!item) throw new Error('Job item not found.');

    const tx = db.transaction(() => {
      db.prepare('DELETE FROM job_items WHERE id = ?').run(payload.jobItemId);

      if (item.allocatedFromStock && item.inventoryItemId) {
        db.prepare('UPDATE inventory_items SET quantity_in_stock = quantity_in_stock + ?, updated_at = ? WHERE id = ?').run(
          item.quantity,
          nowIso(),
          item.inventoryItemId
        );
        db.prepare(
          `INSERT INTO inventory_movements (item_id, movement_type, quantity, reference_type, reference_id, notes, created_by, created_at)
           VALUES (?, 'RESTORE', ?, 'JOB', ?, ?, ?, ?)`
        ).run(item.inventoryItemId, item.quantity, String(payload.jobId), 'Stock restored after job item removal', userId, nowIso());
      }
    });

    tx();
    logActivity(db, 'REMOVE_ITEM', 'JOB', String(payload.jobId), `Item removed from job ${payload.jobId}`, userId);
    return { ok: true };
  },

  updateStatus(
    db: Database,
    payload: { jobId: number; status: Job['status']; actualCompletionDate?: string },
    userId: number
  ) {
    const job = db.prepare('SELECT job_code as jobCode FROM jobs WHERE id = ?').get(payload.jobId) as { jobCode: string } | undefined;
    if (!job) throw new Error('Job not found.');

    if (payload.status === 'Completed') {
      const hasTitle = db.prepare('SELECT title FROM jobs WHERE id = ?').get(payload.jobId) as { title: string } | undefined;
      if (!hasTitle?.title) {
        throw new Error('Job cannot be completed without a title.');
      }
    }

    db.prepare('UPDATE jobs SET status = ?, actual_completion_date = ?, updated_at = ? WHERE id = ?').run(
      payload.status,
      payload.status === 'Completed' ? payload.actualCompletionDate || new Date().toISOString().slice(0, 10) : null,
      nowIso(),
      payload.jobId
    );

    logActivity(db, 'STATUS', 'JOB', job.jobCode, `Job ${job.jobCode} status changed to ${payload.status}`, userId);
    return { ok: true };
  }
};

export const invoiceService = {
  list(db: Database, search?: string, status?: string) {
    const clauses: string[] = [];
    const params: any[] = [];

    if (search?.trim()) {
      clauses.push('(i.invoice_number LIKE ? OR c.name LIKE ? OR j.job_code LIKE ?)');
      const p = `%${search.trim()}%`;
      params.push(p, p, p);
    }

    if (status && status !== 'ALL') {
      clauses.push('i.payment_status = ?');
      params.push(status);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return db
      .prepare(
        `SELECT
          i.id,
          i.invoice_number as invoiceNumber,
          i.customer_id as customerId,
          c.name as customerName,
          i.job_id as jobId,
          j.job_code as jobCode,
          i.estimate_id as estimateId,
          i.issue_date as issueDate,
          i.due_date as dueDate,
          i.discount_type as discountType,
          i.discount_value as discountValue,
          i.subtotal,
          i.discount_amount as discountAmount,
          i.total,
          i.payment_status as paymentStatus,
          i.payment_method as paymentMethod,
          i.notes,
          i.created_by as createdBy,
          i.created_at as createdAt,
          i.updated_at as updatedAt
        FROM invoices i
        INNER JOIN customers c ON c.id = i.customer_id
        INNER JOIN jobs j ON j.id = i.job_id
        ${where}
        ORDER BY datetime(i.created_at) DESC`
      )
      .all(...params);
  },

  get(db: Database, invoiceId: number) {
    const invoice = db
      .prepare(
        `SELECT
          i.id,
          i.invoice_number as invoiceNumber,
          i.customer_id as customerId,
          c.name as customerName,
          c.phone as customerPhone,
          c.email as customerEmail,
          c.address as customerAddress,
          i.job_id as jobId,
          j.job_code as jobCode,
          i.estimate_id as estimateId,
          i.issue_date as issueDate,
          i.due_date as dueDate,
          i.discount_type as discountType,
          i.discount_value as discountValue,
          i.subtotal,
          i.discount_amount as discountAmount,
          i.total,
          i.payment_status as paymentStatus,
          i.payment_method as paymentMethod,
          i.notes,
          i.created_by as createdBy,
          i.created_at as createdAt,
          i.updated_at as updatedAt
        FROM invoices i
        INNER JOIN customers c ON c.id = i.customer_id
        INNER JOIN jobs j ON j.id = i.job_id
        WHERE i.id = ?`
      )
      .get(invoiceId) as Record<string, unknown> | undefined;

    if (!invoice) throw new Error('Invoice not found.');

    return {
      ...invoice,
      items: getInvoiceItems(db, invoiceId)
    };
  },

  createFromJob(
    db: Database,
    payload: {
      jobId: number;
      issueDate: string;
      dueDate?: string;
      discountType: DiscountType;
      discountValue: number;
      paymentStatus: Invoice['paymentStatus'];
      paymentMethod?: Invoice['paymentMethod'];
      notes?: string;
      extraItems?: Array<{ description: string; quantity: number; unitPrice: number }>;
    },
    userId: number
  ) {
    const job = jobService.get(db, payload.jobId) as any;
    if (job.status !== 'Completed') {
      throw new Error('Invoice should be generated from a completed job.');
    }

    const already = db.prepare('SELECT id, invoice_number as invoiceNumber FROM invoices WHERE job_id = ?').get(payload.jobId) as
      | { id: number; invoiceNumber: string }
      | undefined;

    if (already) {
      return { invoiceId: already.id, invoiceNumber: already.invoiceNumber, alreadyExists: true };
    }

    const baseItems = [...(job.items || [])];
    (payload.extraItems || []).forEach((x) => {
      baseItems.push({
        description: x.description,
        quantity: safeNum(x.quantity),
        unitPrice: safeNum(x.unitPrice),
        lineTotal: round2(safeNum(x.quantity) * safeNum(x.unitPrice)),
        sourceType: 'SERVICE'
      });
    });

    if (!baseItems.length) throw new Error('Job has no billable items.');

    const subtotal = round2(baseItems.reduce((sum, item) => sum + safeNum(item.lineTotal), 0));
    subtotal;

    const totals = calculateTotals(subtotal, payload.discountType || 'NONE', safeNum(payload.discountValue));

    const tx = db.transaction(() => {
      const invoiceNumber = getNextNumber(db, 'invoices', 'invoice_number', 'INV');
      const res = db
        .prepare(
          `INSERT INTO invoices (
            invoice_number, customer_id, job_id, estimate_id, issue_date, due_date,
            discount_type, discount_value, subtotal, discount_amount, total,
            payment_status, payment_method, notes, created_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          invoiceNumber,
          job.customerId,
          payload.jobId,
          job.estimateId || null,
          payload.issueDate || new Date().toISOString().slice(0, 10),
          payload.dueDate || null,
          payload.discountType || 'NONE',
          safeNum(payload.discountValue),
          totals.subtotal,
          totals.totalDiscount,
          totals.grandTotal,
          payload.paymentStatus || 'Unpaid',
          payload.paymentMethod || null,
          payload.notes || null,
          userId,
          nowIso(),
          nowIso()
        );

      const invoiceId = Number(res.lastInsertRowid);
      const insertItem = db.prepare(
        `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, line_total, source_type, source_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );

      baseItems.forEach((item: any) => {
        insertItem.run(
          invoiceId,
          item.description,
          safeNum(item.quantity),
          safeNum(item.unitPrice),
          safeNum(item.lineTotal),
          item.inventoryItemId ? 'JOB_ITEM' : item.sourceType || 'SERVICE',
          item.id || null
        );
      });

      logActivity(db, 'CREATE', 'INVOICE', invoiceNumber, `Invoice ${invoiceNumber} created`, userId);
      return { invoiceId, invoiceNumber };
    });

    return tx();
  },

  update(
    db: Database,
    invoiceId: number,
    payload: {
      issueDate: string;
      dueDate?: string;
      discountType: DiscountType;
      discountValue: number;
      paymentStatus: Invoice['paymentStatus'];
      paymentMethod?: Invoice['paymentMethod'];
      notes?: string;
      items: Array<{ description: string; quantity: number; unitPrice: number; sourceType?: string; sourceId?: number }>;
    },
    userId: number
  ) {
    const invoice = db
      .prepare('SELECT invoice_number as invoiceNumber, customer_id as customerId, job_id as jobId FROM invoices WHERE id = ?')
      .get(invoiceId) as { invoiceNumber: string; customerId: number; jobId: number } | undefined;

    if (!invoice) throw new Error('Invoice not found.');
    if (!payload.items.length) throw new Error('At least one invoice line item is required.');

    const subtotal = round2(payload.items.reduce((sum, item) => sum + safeNum(item.quantity) * safeNum(item.unitPrice), 0));
    const totals = calculateTotals(subtotal, payload.discountType, safeNum(payload.discountValue));

    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE invoices SET
          issue_date = ?,
          due_date = ?,
          discount_type = ?,
          discount_value = ?,
          subtotal = ?,
          discount_amount = ?,
          total = ?,
          payment_status = ?,
          payment_method = ?,
          notes = ?,
          updated_at = ?
        WHERE id = ?`
      ).run(
        payload.issueDate,
        payload.dueDate || null,
        payload.discountType,
        safeNum(payload.discountValue),
        totals.subtotal,
        totals.totalDiscount,
        totals.grandTotal,
        payload.paymentStatus,
        payload.paymentMethod || null,
        payload.notes || null,
        nowIso(),
        invoiceId
      );

      db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(invoiceId);
      const insertItem = db.prepare(
        `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, line_total, source_type, source_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );

      payload.items.forEach((item) => {
        insertItem.run(
          invoiceId,
          item.description,
          safeNum(item.quantity),
          safeNum(item.unitPrice),
          round2(safeNum(item.quantity) * safeNum(item.unitPrice)),
          item.sourceType || 'SERVICE',
          item.sourceId || null
        );
      });

      logActivity(db, 'UPDATE', 'INVOICE', invoice.invoiceNumber, `Invoice ${invoice.invoiceNumber} updated`, userId);
    });

    tx();
    return { ok: true };
  },

  updatePayment(
    db: Database,
    payload: {
      invoiceId: number;
      paymentStatus: Invoice['paymentStatus'];
      paymentMethod?: Invoice['paymentMethod'];
      notes?: string;
    },
    userId: number
  ) {
    const invoice = db
      .prepare('SELECT invoice_number as invoiceNumber FROM invoices WHERE id = ?')
      .get(payload.invoiceId) as { invoiceNumber: string } | undefined;

    if (!invoice) throw new Error('Invoice not found.');

    db.prepare(
      'UPDATE invoices SET payment_status = ?, payment_method = ?, notes = ?, updated_at = ? WHERE id = ?'
    ).run(payload.paymentStatus, payload.paymentMethod || null, payload.notes || null, nowIso(), payload.invoiceId);

    logActivity(
      db,
      'PAYMENT_STATUS',
      'INVOICE',
      invoice.invoiceNumber,
      `Invoice ${invoice.invoiceNumber} payment status ${payload.paymentStatus}`,
      userId
    );

    return { ok: true };
  },

  delete(db: Database, invoiceId: number, userId: number) {
    const invoice = db
      .prepare('SELECT invoice_number as invoiceNumber FROM invoices WHERE id = ?')
      .get(invoiceId) as { invoiceNumber: string } | undefined;
    if (!invoice) throw new Error('Invoice not found.');

    db.prepare('DELETE FROM invoices WHERE id = ?').run(invoiceId);
    logActivity(db, 'DELETE', 'INVOICE', invoice.invoiceNumber, `Invoice ${invoice.invoiceNumber} deleted`, userId);
    return { ok: true };
  }
};

export const staffService = {
  list(db: Database, search?: string) {
    const q = (search || '').trim();
    if (!q) {
      return db
        .prepare(
          `SELECT
            id,
            name,
            role_title as roleTitle,
            phone,
            email,
            monthly_salary as monthlySalary,
            is_active as isActive,
            notes,
            created_at as createdAt,
            updated_at as updatedAt
          FROM staff
          ORDER BY datetime(updated_at) DESC`
        )
        .all() as Staff[];
    }

    const p = `%${q}%`;
    return db
      .prepare(
        `SELECT
          id,
          name,
          role_title as roleTitle,
          phone,
          email,
          monthly_salary as monthlySalary,
          is_active as isActive,
          notes,
          created_at as createdAt,
          updated_at as updatedAt
        FROM staff
        WHERE name LIKE ? OR role_title LIKE ? OR phone LIKE ? OR email LIKE ?
        ORDER BY datetime(updated_at) DESC`
      )
      .all(p, p, p, p) as Staff[];
  },

  create(db: Database, payload: Partial<Staff>, userId: number) {
    assertRequired(payload.name, 'Staff name');
    const res = db
      .prepare(
        `INSERT INTO staff (name, role_title, phone, email, monthly_salary, is_active, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        payload.name,
        payload.roleTitle || null,
        payload.phone || null,
        payload.email || null,
        safeNum(payload.monthlySalary),
        payload.isActive ?? 1,
        payload.notes || null,
        nowIso(),
        nowIso()
      );

    const id = Number(res.lastInsertRowid);
    logActivity(db, 'CREATE', 'STAFF', String(id), `Staff ${payload.name} created`, userId);
    return id;
  },

  update(db: Database, id: number, payload: Partial<Staff>, userId: number) {
    assertRequired(payload.name, 'Staff name');
    db.prepare(
      `UPDATE staff SET
        name = ?,
        role_title = ?,
        phone = ?,
        email = ?,
        monthly_salary = ?,
        is_active = ?,
        notes = ?,
        updated_at = ?
      WHERE id = ?`
    ).run(
      payload.name,
      payload.roleTitle || null,
      payload.phone || null,
      payload.email || null,
      safeNum(payload.monthlySalary),
      payload.isActive ?? 1,
      payload.notes || null,
      nowIso(),
      id
    );

    logActivity(db, 'UPDATE', 'STAFF', String(id), `Staff ${payload.name} updated`, userId);
    return { ok: true };
  },

  delete(db: Database, id: number, userId: number) {
    const staff = db.prepare('SELECT name FROM staff WHERE id = ?').get(id) as { name: string } | undefined;
    if (!staff) throw new Error('Staff not found.');
    db.prepare('DELETE FROM staff WHERE id = ?').run(id);
    logActivity(db, 'DELETE', 'STAFF', String(id), `Staff ${staff.name} deleted`, userId);
    return { ok: true };
  },

  jobsByStaff(db: Database, staffId: number) {
    return db
      .prepare(
        `SELECT
          j.id,
          j.job_code as jobCode,
          j.title,
          j.status,
          j.planned_start_date as plannedStartDate,
          j.planned_end_date as plannedEndDate,
          c.name as customerName
        FROM job_staff js
        INNER JOIN jobs j ON j.id = js.job_id
        INNER JOIN customers c ON c.id = j.customer_id
        WHERE js.staff_id = ?
        ORDER BY datetime(j.created_at) DESC`
      )
      .all(staffId);
  },

  salaryList(db: Database, staffId?: number) {
    if (staffId) {
      return db
        .prepare(
          `SELECT
            sr.id,
            sr.staff_id as staffId,
            s.name as staffName,
            sr.month,
            sr.amount,
            sr.is_paid as isPaid,
            sr.notes,
            sr.created_at as createdAt
          FROM salary_records sr
          INNER JOIN staff s ON s.id = sr.staff_id
          WHERE sr.staff_id = ?
          ORDER BY sr.month DESC, datetime(sr.created_at) DESC`
        )
        .all(staffId);
    }

    return db
      .prepare(
        `SELECT
          sr.id,
          sr.staff_id as staffId,
          s.name as staffName,
          sr.month,
          sr.amount,
          sr.is_paid as isPaid,
          sr.notes,
          sr.created_at as createdAt
        FROM salary_records sr
        INNER JOIN staff s ON s.id = sr.staff_id
        ORDER BY sr.month DESC, datetime(sr.created_at) DESC`
      )
      .all();
  },

  addSalaryRecord(
    db: Database,
    payload: { staffId: number; month: string; amount: number; isPaid?: number; notes?: string },
    userId: number
  ) {
    assertRequired(payload.staffId, 'Staff');
    assertRequired(payload.month, 'Month');
    if (safeNum(payload.amount) < 0) throw new Error('Salary amount cannot be negative.');

    const res = db
      .prepare(
        `INSERT INTO salary_records (staff_id, month, amount, is_paid, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(payload.staffId, payload.month, safeNum(payload.amount), payload.isPaid ?? 0, payload.notes || null, nowIso());

    const id = Number(res.lastInsertRowid);
    logActivity(db, 'CREATE', 'SALARY', String(id), `Salary record added for staff ${payload.staffId}`, userId);
    return id;
  },

  updateSalaryStatus(db: Database, id: number, isPaid: number, userId: number) {
    db.prepare('UPDATE salary_records SET is_paid = ? WHERE id = ?').run(isPaid ? 1 : 0, id);
    logActivity(db, 'STATUS', 'SALARY', String(id), `Salary record ${id} marked ${isPaid ? 'paid' : 'unpaid'}`, userId);
    return { ok: true };
  }
};

export const settingsService = {
  getAll(db: Database) {
    const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>;
    return rows.reduce<Record<string, string>>((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});
  },

  updateMany(db: Database, payload: Record<string, string>, userId: number) {
    const stmt = db.prepare(
      `INSERT INTO settings (key, value)
       VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    );

    const tx = db.transaction(() => {
      Object.entries(payload).forEach(([k, v]) => stmt.run(k, String(v ?? '')));
    });
    tx();

    logActivity(db, 'UPDATE', 'SETTINGS', 'global', 'Application settings updated', userId);
    return { ok: true };
  }
};

export const listForExport = (
  db: Database,
  payload: ExportPayload
): Array<Record<string, string | number | null>> => {
  switch (payload.module) {
    case 'inventory':
      return db
        .prepare(
          `SELECT
            id,
            name,
            brand,
            category,
            sku,
            batch_number as batchNumber,
            serial_reference as serialReference,
            image_path as imagePath,
            is_serialized as isSerialized,
            unit_price as unitPrice,
            cost_price as costPrice,
            selling_price as sellingPrice,
            item_discount_type as itemDiscountType,
            item_discount_value as itemDiscountValue,
            pricing_method as pricingMethod,
            profit_percentage_target as profitPercentageTarget,
            (selling_price - (
              CASE
                WHEN item_discount_type = 'PERCENTAGE' THEN (selling_price * item_discount_value / 100.0)
                WHEN item_discount_type = 'FIXED' THEN item_discount_value
                ELSE 0
              END
            )) as effectiveSellingPrice,
            ((selling_price - (
              CASE
                WHEN item_discount_type = 'PERCENTAGE' THEN (selling_price * item_discount_value / 100.0)
                WHEN item_discount_type = 'FIXED' THEN item_discount_value
                ELSE 0
              END
            )) - cost_price) as unitProfit,
            quantity_in_stock as quantityInStock,
            reorder_level as reorderLevel,
            supplier_name as supplier,
            notes,
            created_at as createdAt,
            updated_at as updatedAt
          FROM inventory_items`
        )
        .all() as Array<Record<string, string | number | null>>;
    case 'customers':
      return db
        .prepare(
          'SELECT id, name, phone, email, address, notes, created_at as createdAt, updated_at as updatedAt FROM customers'
        )
        .all() as Array<Record<string, string | number | null>>;
    case 'suppliers':
      return db
        .prepare(
          `SELECT
            s.id,
            s.name,
            s.contact_person as contactPerson,
            s.phone,
            s.email,
            s.address,
            s.is_active as isActive,
            COALESCE(SUM(ssr.amount), 0) as totalSpent,
            COUNT(ssr.id) as purchaseCount,
            MAX(ssr.purchase_date) as lastPurchaseDate,
            s.created_at as createdAt,
            s.updated_at as updatedAt
          FROM suppliers s
          LEFT JOIN supplier_spend_records ssr ON ssr.supplier_id = s.id
          GROUP BY
            s.id,
            s.name,
            s.contact_person,
            s.phone,
            s.email,
            s.address,
            s.is_active,
            s.created_at,
            s.updated_at`
        )
        .all() as Array<Record<string, string | number | null>>;
    case 'estimates':
      return db
        .prepare(
          `SELECT
            e.id,
            e.estimate_number as estimateNumber,
            c.name as customer,
            e.issue_date as issueDate,
            e.status,
            e.subtotal,
            e.total_discount as totalDiscount,
            e.grand_total as grandTotal,
            e.created_at as createdAt
          FROM estimates e
          INNER JOIN customers c ON c.id = e.customer_id`
        )
        .all() as Array<Record<string, string | number | null>>;
    case 'jobs':
      return db
        .prepare(
          `SELECT
            j.id,
            j.job_code as jobCode,
            c.name as customer,
            j.title,
            j.status,
            j.planned_start_date as plannedStart,
            j.planned_end_date as plannedEnd,
            j.actual_completion_date as completedOn,
            j.estimated_amount as estimatedAmount,
            j.labor_charges as laborCharges,
            j.extra_charges as extraCharges,
            j.created_at as createdAt
          FROM jobs j
          INNER JOIN customers c ON c.id = j.customer_id`
        )
        .all() as Array<Record<string, string | number | null>>;
    case 'invoices':
      return db
        .prepare(
          `SELECT
            i.id,
            i.invoice_number as invoiceNumber,
            c.name as customer,
            j.job_code as jobCode,
            i.issue_date as issueDate,
            i.payment_status as paymentStatus,
            i.total,
            i.created_at as createdAt
          FROM invoices i
          INNER JOIN customers c ON c.id = i.customer_id
          INNER JOIN jobs j ON j.id = i.job_id`
        )
        .all() as Array<Record<string, string | number | null>>;
    case 'staff':
      return db
        .prepare(
          `SELECT
            id,
            name,
            role_title as roleTitle,
            phone,
            email,
            monthly_salary as monthlySalary,
            is_active as isActive,
            notes,
            created_at as createdAt,
            updated_at as updatedAt
          FROM staff`
        )
        .all() as Array<Record<string, string | number | null>>;
    default:
      throw new Error('Unsupported export module.');
  }
};
