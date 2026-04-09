import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { InventoryItem } from '@shared/types';
import { apiRequest, exportModule } from '../lib/api';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useUiStore } from '../store/uiStore';
import { formatCurrency } from '../utils/format';

type StockFilter = 'ALL' | 'LOW' | 'OUT';
type ItemDiscountType = 'NONE' | 'PERCENTAGE' | 'FIXED';
type PricingMethod = 'MANUAL' | 'PROFIT_PERCENTAGE';

interface JobOption {
  id: number;
  jobCode: string;
  title: string;
  status: string;
}

interface SupplierOption {
  id: number;
  name: string;
}

interface MovementRow {
  id: number;
  itemId: number;
  movementType: string;
  quantity: number;
  referenceType?: string;
  referenceId?: string;
  notes?: string;
  createdAt: string;
}

interface InventoryAnalytics {
  fromDate: string;
  toDate: string;
  totalSupplierSpend: number;
  spendRecords: number;
  inventoryRevenue: number;
  inventoryCost: number;
  inventoryProfit: number;
  profitMarginPct: number;
  byItem: Array<{
    itemId: number;
    itemName: string;
    quantitySold: number;
    revenue: number;
    cost: number;
    profit: number;
  }>;
}

const emptyForm: Partial<InventoryItem> = {
  name: '',
  brand: '',
  category: '',
  sku: '',
  batchNumber: '',
  serialReference: '',
  imagePath: '',
  isSerialized: 0,
  unitPrice: 0,
  costPrice: 0,
  sellingPrice: 0,
  itemDiscountType: 'NONE',
  itemDiscountValue: 0,
  pricingMethod: 'MANUAL',
  profitPercentageTarget: 0,
  quantityInStock: 0,
  reorderLevel: 0,
  supplierId: 0,
  supplierName: '',
  notes: ''
};

export const InventoryPage = () => {
  const notify = useUiStore((s) => s.notify);

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [stockFilter, setStockFilter] = useState<StockFilter>('ALL');
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [form, setForm] = useState<Partial<InventoryItem>>(emptyForm);
  const [openForm, setOpenForm] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [movementItemId, setMovementItemId] = useState<number | null>(null);
  const [showMovements, setShowMovements] = useState(false);

  const [adjustItemId, setAdjustItemId] = useState<number | null>(null);
  const [adjustDelta, setAdjustDelta] = useState(0);
  const [adjustNotes, setAdjustNotes] = useState('');

  const [jobs, setJobs] = useState<JobOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [allocateItemId, setAllocateItemId] = useState<number | null>(null);
  const [allocateJobId, setAllocateJobId] = useState<number>(0);
  const [allocateQty, setAllocateQty] = useState<number>(1);
  const [analyticsFromDate, setAnalyticsFromDate] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  });
  const [analyticsToDate, setAnalyticsToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [analytics, setAnalytics] = useState<InventoryAnalytics | null>(null);

  const effectivePrice = (item: Partial<InventoryItem>) => {
    const sell = Number(item.sellingPrice || 0);
    const discountType = (item.itemDiscountType || 'NONE') as ItemDiscountType;
    const discountValue = Number(item.itemDiscountValue || 0);
    const discount =
      discountType === 'PERCENTAGE'
        ? (sell * Math.max(0, Math.min(100, discountValue))) / 100
        : discountType === 'FIXED'
        ? discountValue
        : 0;
    return Math.max(0, sell - discount);
  };

  const loadAnalytics = async (fromDate = analyticsFromDate, toDate = analyticsToDate) => {
    const data = await apiRequest<InventoryAnalytics>('inventory/analytics', { fromDate, toDate });
    setAnalytics(data);
  };

  const load = async () => {
    const [inventoryData, meta, movementData] = await Promise.all([
      apiRequest<InventoryItem[]>('inventory/list', { search }),
      apiRequest<{ jobs: JobOption[]; suppliers: SupplierOption[] }>('meta/options'),
      apiRequest<MovementRow[]>('inventory/movements')
    ]);
    setItems(inventoryData);
    setJobs((meta.jobs || []).filter((j) => j.status !== 'Completed' && j.status !== 'Cancelled'));
    setSuppliers((meta.suppliers || []).filter((s) => s.name));
    setMovements(movementData);
  };

  useEffect(() => {
    void load();
    void loadAnalytics();
  }, []);

  const categories = useMemo(
    () => ['ALL', ...new Set(items.map((i) => (i.category || '').trim()).filter(Boolean))],
    [items]
  );

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const categoryOk = categoryFilter === 'ALL' || (item.category || '') === categoryFilter;
      const qty = Number(item.quantityInStock || 0);
      const reorder = Number(item.reorderLevel || 0);
      const stockOk =
        stockFilter === 'ALL' ||
        (stockFilter === 'LOW' && qty <= reorder && qty > 0) ||
        (stockFilter === 'OUT' && qty <= 0);
      return categoryOk && stockOk;
    });
  }, [items, categoryFilter, stockFilter]);

  const lowStockCount = useMemo(
    () => items.filter((i) => Number(i.quantityInStock) <= Number(i.reorderLevel) && Number(i.quantityInStock) > 0).length,
    [items]
  );
  const outOfStockCount = useMemo(() => items.filter((i) => Number(i.quantityInStock) <= 0).length, [items]);
  const stockValue = useMemo(
    () => items.reduce((sum, i) => sum + Number(i.quantityInStock || 0) * Number(i.costPrice || 0), 0),
    [items]
  );
  const serializedCount = useMemo(() => items.filter((i) => Boolean(i.isSerialized)).length, [items]);

  const selectedItem = useMemo(
    () => (movementItemId ? items.find((item) => item.id === movementItemId) || null : null),
    [movementItemId, items]
  );

  const selectedItemMovements = useMemo(
    () => (movementItemId ? movements.filter((m) => m.itemId === movementItemId) : movements),
    [movementItemId, movements]
  );

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setOpenForm(true);
  };

  const openEdit = (item: InventoryItem) => {
    setEditing(item);
    setForm(item);
    setOpenForm(true);
  };

  const submitForm = async (e: FormEvent) => {
    e.preventDefault();
    try {
      if (!form.name?.trim()) throw new Error('Item name is required.');
      if (!form.sku?.trim()) throw new Error('SKU/internal code is required.');
      if (Number(form.quantityInStock || 0) < 0) throw new Error('Quantity cannot be negative.');

      const pricingMethod = (form.pricingMethod || 'MANUAL') as PricingMethod;
      const costPrice = Number(form.costPrice || 0);
      const targetProfitPct = Number(form.profitPercentageTarget || 0);
      const computedSellingPrice =
        pricingMethod === 'PROFIT_PERCENTAGE'
          ? costPrice + costPrice * (Math.max(0, targetProfitPct) / 100)
          : Number(form.sellingPrice || 0);
      const discountType = (form.itemDiscountType || 'NONE') as ItemDiscountType;
      const discountValue = Number(form.itemDiscountValue || 0);

      if (discountType === 'PERCENTAGE' && discountValue > 100) {
        throw new Error('Discount percentage cannot exceed 100.');
      }
      if (discountType === 'FIXED' && discountValue > computedSellingPrice) {
        throw new Error('Discount value cannot exceed selling price.');
      }

      const payload = {
        ...form,
        pricingMethod,
        sellingPrice: computedSellingPrice
      };

      if (editing) {
        await apiRequest('inventory/update', { id: editing.id, data: payload });
        notify('success', 'Inventory item updated.');
      } else {
        await apiRequest('inventory/create', payload);
        notify('success', 'Inventory item created.');
      }
      setOpenForm(false);
      await load();
      await loadAnalytics();
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const selectItemImage = async () => {
    try {
      const selected = await apiRequest<{ canceled: boolean; filePath?: string }>('files/select-image', {
        title: 'Select inventory item image'
      });
      if (selected.canceled || !selected.filePath) return;

      const saved = await apiRequest<{ path: string }>('files/save-image', { filePath: selected.filePath });
      setForm((p) => ({ ...p, imagePath: saved.path }));
      notify('success', 'Item image selected.');
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const deleteItem = async () => {
    if (!deletingId) return;
    try {
      await apiRequest('inventory/delete', { id: deletingId });
      notify('success', 'Inventory item deleted.');
      setDeletingId(null);
      await load();
      await loadAnalytics();
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const adjustStock = async () => {
    if (!adjustItemId) return;
    try {
      await apiRequest('inventory/adjust', { itemId: adjustItemId, delta: adjustDelta, notes: adjustNotes });
      notify('success', 'Stock adjusted successfully.');
      setAdjustItemId(null);
      setAdjustDelta(0);
      setAdjustNotes('');
      await load();
      await loadAnalytics();
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const allocateStock = async () => {
    if (!allocateItemId || !allocateJobId) {
      notify('error', 'Select both job and item quantity details.');
      return;
    }

    try {
      await apiRequest('inventory/allocate', {
        inventoryItemId: allocateItemId,
        jobId: allocateJobId,
        quantity: allocateQty
      });
      notify('success', 'Stock allocated to job.');
      setAllocateItemId(null);
      setAllocateJobId(0);
      setAllocateQty(1);
      await load();
      await loadAnalytics();
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const runExport = async (format: 'xlsx' | 'csv') => {
    try {
      const res = await exportModule('inventory', format);
      if (!res.canceled) notify('success', `Inventory exported to ${res.filePath}`);
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const resetFilters = async () => {
    setSearch('');
    setCategoryFilter('ALL');
    setStockFilter('ALL');
    const [inventoryData, movementData] = await Promise.all([
      apiRequest<InventoryItem[]>('inventory/list', { search: '' }),
      apiRequest<MovementRow[]>('inventory/movements')
    ]);
    setItems(inventoryData);
    setMovements(movementData);
  };

  const stockStatus = (item: InventoryItem) => {
    const qty = Number(item.quantityInStock || 0);
    const reorder = Number(item.reorderLevel || 0);
    if (qty <= 0) return { label: 'Out', className: 'bg-rose-100 text-rose-700' };
    if (qty <= reorder) return { label: 'Low', className: 'bg-amber-100 text-amber-700' };
    return { label: 'Healthy', className: 'bg-emerald-100 text-emerald-700' };
  };

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle="Track stock, reorder risk, and allocations"
        actions={
          <>
            <button className="btn-secondary" onClick={() => runExport('xlsx')}>Export XLSX</button>
            <button className="btn-secondary" onClick={() => runExport('csv')}>Export CSV</button>
            <button className="btn-primary" onClick={openCreate}>Add Item</button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="card">
          <div className="text-xs uppercase tracking-wide text-slate-500">Total Items</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{items.length}</div>
        </div>
        <div className="card">
          <div className="text-xs uppercase tracking-wide text-slate-500">Low Stock</div>
          <div className="mt-1 text-2xl font-semibold text-amber-700">{lowStockCount}</div>
        </div>
        <div className="card">
          <div className="text-xs uppercase tracking-wide text-slate-500">Out Of Stock</div>
          <div className="mt-1 text-2xl font-semibold text-rose-700">{outOfStockCount}</div>
        </div>
        <div className="card">
          <div className="text-xs uppercase tracking-wide text-slate-500">Stock Value (Cost)</div>
          <div className="mt-1 text-2xl font-semibold text-brand-700">{formatCurrency(stockValue)}</div>
          <div className="mt-1 text-xs text-slate-500">Serialized items: {serializedCount}</div>
        </div>
      </div>

      <div className="mb-4 card">
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-slate-500">From</label>
            <input className="input h-9" type="date" value={analyticsFromDate} onChange={(e) => setAnalyticsFromDate(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-slate-500">To</label>
            <input className="input h-9" type="date" value={analyticsToDate} onChange={(e) => setAnalyticsToDate(e.target.value)} />
          </div>
          <button className="btn-secondary h-9" onClick={() => void loadAnalytics(analyticsFromDate, analyticsToDate)}>
            Analyze Period
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Supplier Spend</div>
            <div className="text-lg font-semibold text-rose-700">{formatCurrency(analytics?.totalSupplierSpend || 0)}</div>
            <div className="text-xs text-slate-500">Records: {analytics?.spendRecords || 0}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Inventory Revenue</div>
            <div className="text-lg font-semibold text-slate-900">{formatCurrency(analytics?.inventoryRevenue || 0)}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Inventory Cost</div>
            <div className="text-lg font-semibold text-slate-900">{formatCurrency(analytics?.inventoryCost || 0)}</div>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <div className="text-xs uppercase tracking-wide text-emerald-700">Inventory Profit</div>
            <div className="text-lg font-semibold text-emerald-800">{formatCurrency(analytics?.inventoryProfit || 0)}</div>
            <div className="text-xs text-emerald-700">Margin: {(analytics?.profitMarginPct || 0).toFixed(2)}%</div>
          </div>
        </div>

        <div className="mt-3">
          <div className="mb-2 text-sm font-semibold text-slate-900">Inventory Profit By Item (Selected Period)</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Qty Sold</th>
                  <th>Revenue</th>
                  <th>Cost</th>
                  <th>Profit</th>
                </tr>
              </thead>
              <tbody>
                {analytics?.byItem?.length ? (
                  analytics.byItem.slice(0, 20).map((row) => (
                    <tr key={row.itemId}>
                      <td>{row.itemName}</td>
                      <td>{row.quantitySold}</td>
                      <td>{formatCurrency(row.revenue)}</td>
                      <td>{formatCurrency(row.cost)}</td>
                      <td className={row.profit >= 0 ? 'text-emerald-700' : 'text-rose-700'}>{formatCurrency(row.profit)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="text-center text-slate-500">No inventory-linked sales in selected period.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="mb-4 card">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
          <input
            className="input md:col-span-2"
            placeholder="Search by name, brand, code, category"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            {categories.map((category) => (
              <option key={category} value={category}>{category === 'ALL' ? 'All Categories' : category}</option>
            ))}
          </select>
          <select className="select" value={stockFilter} onChange={(e) => setStockFilter(e.target.value as StockFilter)}>
            <option value="ALL">All Stock</option>
            <option value="LOW">Low Stock</option>
            <option value="OUT">Out Of Stock</option>
          </select>
          <div className="flex gap-2">
            <button className="btn-secondary w-full" onClick={() => void load()}>Apply</button>
            <button className="btn-secondary w-full" onClick={() => void resetFilters()}>Reset</button>
          </div>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Category</th>
              <th>Price</th>
              <th>Stock</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.length ? (
              filteredItems.map((item) => {
                const status = stockStatus(item);
                return (
                  <tr key={item.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        {item.imagePath ? (
                          <img src={item.imagePath} alt={item.name} className="h-11 w-11 rounded-md border border-slate-200 object-cover" />
                        ) : (
                          <div className="flex h-11 w-11 items-center justify-center rounded-md border border-dashed border-slate-300 text-[10px] text-slate-400">No Img</div>
                        )}
                        <div>
                          <div className="font-medium">{item.name}</div>
                          <div className="text-xs text-slate-500">
                            {item.sku} • {item.brand || '-'} • {item.batchNumber || '-'} • {item.supplierName || 'No Supplier'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>{item.category || '-'}</td>
                    <td>
                      <div className="text-xs text-slate-500">Cost: {formatCurrency(item.costPrice)}</div>
                      <div className="font-medium">Sell: {formatCurrency(item.sellingPrice)}</div>
                      <div className="text-xs text-slate-500">Effective: {formatCurrency(item.effectiveSellingPrice ?? effectivePrice(item))}</div>
                      <div className={`text-xs font-medium ${Number((item.effectiveSellingPrice ?? effectivePrice(item)) - Number(item.costPrice || 0)) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                        Unit Profit: {formatCurrency((item.effectiveSellingPrice ?? effectivePrice(item)) - Number(item.costPrice || 0))}
                      </div>
                    </td>
                    <td>
                      <div className="font-semibold">{item.quantityInStock}</div>
                      <div className="text-xs text-slate-500">Reorder: {item.reorderLevel}</div>
                    </td>
                    <td>
                      <span className={`badge ${status.className}`}>{status.label}</span>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        <button className="btn-secondary" onClick={() => openEdit(item)}>Edit</button>
                        <button
                          className="btn-secondary"
                          onClick={() => {
                            setAdjustItemId(item.id);
                            setAdjustDelta(0);
                          }}
                        >
                          Adjust
                        </button>
                        <button
                          className="btn-secondary"
                          onClick={() => {
                            setAllocateItemId(item.id);
                            setAllocateQty(1);
                          }}
                        >
                          Allocate
                        </button>
                        <button
                          className="btn-secondary"
                          onClick={() => {
                            setMovementItemId(item.id);
                            setShowMovements(true);
                          }}
                        >
                          History
                        </button>
                        <button className="btn-danger" onClick={() => setDeletingId(item.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={6} className="text-center text-slate-500">No inventory items match this filter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-5 card">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Stock Movement History</h2>
            {selectedItem ? (
              <p className="text-xs text-slate-500">Filtered by: {selectedItem.name}</p>
            ) : (
              <p className="text-xs text-slate-500">Showing recent stock movement activity</p>
            )}
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => setShowMovements((v) => !v)}>
              {showMovements ? 'Hide' : 'Show'} History
            </button>
            {movementItemId ? (
              <button className="btn-secondary" onClick={() => setMovementItemId(null)}>
                Clear Item Filter
              </button>
            ) : null}
          </div>
        </div>

        {showMovements ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Type</th>
                  <th>Qty</th>
                  <th>Reference</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {selectedItemMovements.length ? (
                  selectedItemMovements.slice(0, 150).map((mv) => (
                    <tr key={mv.id}>
                      <td>{new Date(mv.createdAt).toLocaleString()}</td>
                      <td>{mv.movementType}</td>
                      <td>{mv.quantity}</td>
                      <td>
                        {mv.referenceType || '-'} {mv.referenceId || ''}
                      </td>
                      <td>{mv.notes || '-'}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="text-center text-slate-500">No stock movements found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <Modal open={openForm} onClose={() => setOpenForm(false)} title={editing ? 'Edit Item' : 'Add Item'}>
        <form className="grid grid-cols-1 gap-3 md:grid-cols-2" onSubmit={submitForm}>
          <div>
            <label className="mb-1 block text-sm">Item Name *</label>
            <input className="input" value={form.name || ''} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
          </div>
          <div>
            <label className="mb-1 block text-sm">Brand</label>
            <input className="input" value={form.brand || ''} onChange={(e) => setForm((p) => ({ ...p, brand: e.target.value }))} />
          </div>
          <div>
            <label className="mb-1 block text-sm">Category</label>
            <input className="input" value={form.category || ''} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))} />
          </div>
          <div>
            <label className="mb-1 block text-sm">SKU / Code *</label>
            <input className="input" value={form.sku || ''} onChange={(e) => setForm((p) => ({ ...p, sku: e.target.value }))} />
          </div>
          <div>
            <label className="mb-1 block text-sm">Batch No</label>
            <input className="input" value={form.batchNumber || ''} onChange={(e) => setForm((p) => ({ ...p, batchNumber: e.target.value }))} />
          </div>
          <div>
            <label className="mb-1 block text-sm">Serial / QR Ref</label>
            <input className="input" value={form.serialReference || ''} onChange={(e) => setForm((p) => ({ ...p, serialReference: e.target.value }))} />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm">Item Image</label>
            <div className="flex items-center gap-2">
              <input className="input" value={form.imagePath || ''} readOnly placeholder="No image selected" />
              <button type="button" className="btn-secondary" onClick={() => void selectItemImage()}>Choose</button>
              {form.imagePath ? (
                <button type="button" className="btn-secondary" onClick={() => setForm((p) => ({ ...p, imagePath: '' }))}>Clear</button>
              ) : null}
            </div>
            {form.imagePath ? (
              <img src={form.imagePath} alt="Item preview" className="mt-2 h-16 w-16 rounded-md border border-slate-200 object-cover" />
            ) : null}
          </div>
          <div>
            <label className="mb-1 block text-sm">Unit Price (LKR)</label>
            <input className="input" type="number" min="0" step="0.01" value={form.unitPrice || 0} onChange={(e) => setForm((p) => ({ ...p, unitPrice: Number(e.target.value) }))} />
          </div>
          <div>
            <label className="mb-1 block text-sm">Cost Price (LKR)</label>
            <input className="input" type="number" min="0" step="0.01" value={form.costPrice || 0} onChange={(e) => setForm((p) => ({ ...p, costPrice: Number(e.target.value) }))} />
          </div>
          <div>
            <label className="mb-1 block text-sm">Pricing Method</label>
            <select
              className="select"
              value={(form.pricingMethod as PricingMethod) || 'MANUAL'}
              onChange={(e) => setForm((p) => ({ ...p, pricingMethod: e.target.value as PricingMethod }))}
            >
              <option value="MANUAL">Manual Selling Price</option>
              <option value="PROFIT_PERCENTAGE">By Profit Percentage</option>
            </select>
          </div>
          {(form.pricingMethod || 'MANUAL') === 'PROFIT_PERCENTAGE' ? (
            <div>
              <label className="mb-1 block text-sm">Target Profit %</label>
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                value={form.profitPercentageTarget || 0}
                onChange={(e) => setForm((p) => ({ ...p, profitPercentageTarget: Number(e.target.value) }))}
              />
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-sm">Selling Price (LKR)</label>
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                value={form.sellingPrice || 0}
                onChange={(e) => setForm((p) => ({ ...p, sellingPrice: Number(e.target.value) }))}
              />
            </div>
          )}
          <div>
            <label className="mb-1 block text-sm">Item Discount Type</label>
            <select
              className="select"
              value={(form.itemDiscountType as ItemDiscountType) || 'NONE'}
              onChange={(e) => setForm((p) => ({ ...p, itemDiscountType: e.target.value as ItemDiscountType }))}
            >
              <option value="NONE">None</option>
              <option value="PERCENTAGE">Percentage</option>
              <option value="FIXED">Fixed LKR</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm">Item Discount Value</label>
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={form.itemDiscountValue || 0}
              onChange={(e) => setForm((p) => ({ ...p, itemDiscountValue: Number(e.target.value) }))}
            />
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm md:col-span-2">
            <div>
              Effective Selling Price:{' '}
              <span className="font-semibold">
                {formatCurrency(
                  effectivePrice({
                    sellingPrice:
                      (form.pricingMethod || 'MANUAL') === 'PROFIT_PERCENTAGE'
                        ? Number(form.costPrice || 0) + (Number(form.costPrice || 0) * Number(form.profitPercentageTarget || 0)) / 100
                        : Number(form.sellingPrice || 0),
                    itemDiscountType: form.itemDiscountType,
                    itemDiscountValue: form.itemDiscountValue
                  })
                )}
              </span>
            </div>
            <div>
              Unit Profit:{' '}
              <span className="font-semibold">
                {formatCurrency(
                  effectivePrice({
                    sellingPrice:
                      (form.pricingMethod || 'MANUAL') === 'PROFIT_PERCENTAGE'
                        ? Number(form.costPrice || 0) + (Number(form.costPrice || 0) * Number(form.profitPercentageTarget || 0)) / 100
                        : Number(form.sellingPrice || 0),
                    itemDiscountType: form.itemDiscountType,
                    itemDiscountValue: form.itemDiscountValue
                  }) - Number(form.costPrice || 0)
                )}
              </span>
            </div>
          </div>
          {!editing ? (
            <div>
              <label className="mb-1 block text-sm">Initial Quantity</label>
              <input className="input" type="number" min="0" step="1" value={form.quantityInStock || 0} onChange={(e) => setForm((p) => ({ ...p, quantityInStock: Number(e.target.value) }))} />
            </div>
          ) : null}
          <div>
            <label className="mb-1 block text-sm">Reorder Level</label>
            <input className="input" type="number" min="0" step="1" value={form.reorderLevel || 0} onChange={(e) => setForm((p) => ({ ...p, reorderLevel: Number(e.target.value) }))} />
          </div>
          <div>
            <label className="mb-1 block text-sm">Supplier</label>
            <select
              className="select"
              value={Number(form.supplierId || 0)}
              onChange={(e) => {
                const nextId = Number(e.target.value);
                const supplier = suppliers.find((s) => s.id === nextId);
                setForm((p) => ({ ...p, supplierId: nextId || undefined, supplierName: supplier?.name || '' }));
              }}
            >
              <option value={0}>Select supplier</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm">Notes</label>
            <textarea className="textarea" rows={3} value={form.notes || ''} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
          </div>
          <label className="inline-flex items-center gap-2 text-sm md:col-span-2">
            <input type="checkbox" checked={Boolean(form.isSerialized)} onChange={(e) => setForm((p) => ({ ...p, isSerialized: e.target.checked ? 1 : 0 }))} />
            Serialized item
          </label>
          <div className="md:col-span-2 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setOpenForm(false)}>Cancel</button>
            <button type="submit" className="btn-primary">{editing ? 'Update' : 'Create'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={adjustItemId !== null} onClose={() => setAdjustItemId(null)} title="Adjust Stock" width="max-w-md">
        <div className="space-y-3">
          <p className="text-sm text-slate-600">Use positive values to add stock, negative values to reduce stock.</p>
          <input className="input" type="number" step="1" value={adjustDelta} onChange={(e) => setAdjustDelta(Number(e.target.value))} />
          <textarea className="textarea" rows={3} placeholder="Reason / notes" value={adjustNotes} onChange={(e) => setAdjustNotes(e.target.value)} />
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setAdjustItemId(null)}>Cancel</button>
            <button className="btn-primary" onClick={() => void adjustStock()}>Save Adjustment</button>
          </div>
        </div>
      </Modal>

      <Modal open={allocateItemId !== null} onClose={() => setAllocateItemId(null)} title="Allocate Stock to Job" width="max-w-md">
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm">Job</label>
            <select className="select" value={allocateJobId} onChange={(e) => setAllocateJobId(Number(e.target.value))}>
              <option value={0}>Select job</option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>{job.jobCode} - {job.title}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm">Quantity</label>
            <input className="input" type="number" min="1" step="1" value={allocateQty} onChange={(e) => setAllocateQty(Number(e.target.value))} />
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setAllocateItemId(null)}>Cancel</button>
            <button className="btn-primary" onClick={() => void allocateStock()}>Allocate</button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={deletingId !== null}
        title="Delete Item"
        message="Are you sure you want to delete this inventory item? This cannot be undone."
        onCancel={() => setDeletingId(null)}
        onConfirm={() => void deleteItem()}
        confirmLabel="Delete"
      />
    </div>
  );
};
