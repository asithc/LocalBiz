import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { Supplier } from '@shared/types';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { apiRequest, exportModule } from '../lib/api';
import { useUiStore } from '../store/uiStore';
import { formatCurrency, formatDate } from '../utils/format';

interface SupplierRow extends Supplier {
  totalSpent?: number;
  purchaseCount?: number;
  linkedItemCount?: number;
  lastPurchaseDate?: string;
}

interface InventoryOption {
  id: number;
  name: string;
  sku: string;
}

interface SupplierSpend {
  id: number;
  supplierId: number;
  inventoryItemId?: number;
  itemName?: string;
  purchaseDate: string;
  quantity: number;
  unitCost: number;
  amount: number;
  referenceNo?: string;
  notes?: string;
  createdAt: string;
}

interface SupplierDetails {
  supplier: Supplier;
  summary: {
    purchaseCount: number;
    totalSpent: number;
    lastPurchaseDate?: string;
    linkedItemCount: number;
  };
  spends: SupplierSpend[];
  items: Array<{
    id: number;
    name: string;
    sku: string;
    category?: string;
    quantityInStock: number;
    costPrice: number;
  }>;
}

const emptyForm: Partial<Supplier> = {
  name: '',
  contactPerson: '',
  phone: '',
  email: '',
  address: '',
  notes: '',
  isActive: 1
};

export const SuppliersPage = () => {
  const notify = useUiStore((s) => s.notify);

  const [rows, setRows] = useState<SupplierRow[]>([]);
  const [inventory, setInventory] = useState<InventoryOption[]>([]);
  const [search, setSearch] = useState('');

  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState<SupplierRow | null>(null);
  const [form, setForm] = useState<Partial<Supplier>>(emptyForm);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedSupplierId, setSelectedSupplierId] = useState<number | null>(null);
  const [details, setDetails] = useState<SupplierDetails | null>(null);

  const [spendItemId, setSpendItemId] = useState<number>(0);
  const [spendDate, setSpendDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [spendQty, setSpendQty] = useState<number>(0);
  const [spendUnitCost, setSpendUnitCost] = useState<number>(0);
  const [spendAmount, setSpendAmount] = useState<number>(0);
  const [spendRef, setSpendRef] = useState('');
  const [spendNotes, setSpendNotes] = useState('');
  const [deletingSpendId, setDeletingSpendId] = useState<number | null>(null);

  const load = async () => {
    const [supplierRows, meta] = await Promise.all([
      apiRequest<SupplierRow[]>('suppliers/list', { search }),
      apiRequest<{ inventory: InventoryOption[] }>('meta/options')
    ]);
    setRows(supplierRows);
    setInventory(meta.inventory || []);
  };

  useEffect(() => {
    void load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setOpenForm(true);
  };

  const openEdit = (row: SupplierRow) => {
    setEditing(row);
    setForm(row);
    setOpenForm(true);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      if (!form.name?.trim()) throw new Error('Supplier name is required.');

      if (editing) {
        await apiRequest('suppliers/update', { id: editing.id, data: form });
        notify('success', 'Supplier updated.');
      } else {
        await apiRequest('suppliers/create', form);
        notify('success', 'Supplier created.');
      }

      setOpenForm(false);
      await load();
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const remove = async () => {
    if (!deleteId) return;
    try {
      await apiRequest('suppliers/delete', { id: deleteId });
      notify('success', 'Supplier deleted.');
      setDeleteId(null);
      await load();
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const openDetails = async (supplierId: number) => {
    try {
      setSelectedSupplierId(supplierId);
      const data = await apiRequest<SupplierDetails>('suppliers/get', { id: supplierId });
      setDetails(data);
      setDetailsOpen(true);
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const refreshDetails = async () => {
    if (!selectedSupplierId) return;
    const data = await apiRequest<SupplierDetails>('suppliers/get', { id: selectedSupplierId });
    setDetails(data);
  };

  const saveSpend = async () => {
    if (!selectedSupplierId) return;
    try {
      await apiRequest('suppliers/spend/add', {
        supplierId: selectedSupplierId,
        inventoryItemId: spendItemId || undefined,
        purchaseDate: spendDate,
        quantity: spendQty,
        unitCost: spendUnitCost,
        amount: spendAmount,
        referenceNo: spendRef,
        notes: spendNotes
      });
      notify('success', 'Supplier purchase/spend recorded.');
      setSpendItemId(0);
      setSpendQty(0);
      setSpendUnitCost(0);
      setSpendAmount(0);
      setSpendRef('');
      setSpendNotes('');
      await refreshDetails();
      await load();
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const deleteSpend = async () => {
    if (!selectedSupplierId || !deletingSpendId) return;
    try {
      await apiRequest('suppliers/spend/delete', { supplierId: selectedSupplierId, spendId: deletingSpendId });
      notify('success', 'Supplier spend record deleted.');
      setDeletingSpendId(null);
      await refreshDetails();
      await load();
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const runExport = async (format: 'xlsx' | 'csv') => {
    try {
      const res = await exportModule('suppliers', format);
      if (!res.canceled) notify('success', `Suppliers exported to ${res.filePath}`);
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const totals = useMemo(
    () => ({
      suppliers: rows.length,
      totalSpent: rows.reduce((sum, row) => sum + Number(row.totalSpent || 0), 0),
      totalPurchases: rows.reduce((sum, row) => sum + Number(row.purchaseCount || 0), 0)
    }),
    [rows]
  );

  const computedAmount = useMemo(() => {
    const calc = Number(spendQty || 0) * Number(spendUnitCost || 0);
    return calc > 0 ? calc : 0;
  }, [spendQty, spendUnitCost]);

  return (
    <div>
      <PageHeader
        title="Suppliers"
        subtitle="Track suppliers, contacts, item sources, and purchase spend"
        actions={
          <>
            <button className="btn-secondary" onClick={() => runExport('xlsx')}>
              Export XLSX
            </button>
            <button className="btn-secondary" onClick={() => runExport('csv')}>
              Export CSV
            </button>
            <button className="btn-primary" onClick={openCreate}>
              Add Supplier
            </button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="card">
          <div className="text-xs uppercase tracking-wide text-slate-500">Suppliers</div>
          <div className="mt-1 text-xl font-semibold text-slate-900">{totals.suppliers}</div>
        </div>
        <div className="card">
          <div className="text-xs uppercase tracking-wide text-slate-500">Purchase Records</div>
          <div className="mt-1 text-xl font-semibold text-slate-900">{totals.totalPurchases}</div>
        </div>
        <div className="card">
          <div className="text-xs uppercase tracking-wide text-slate-500">Total Supplier Spend</div>
          <div className="mt-1 text-xl font-semibold text-rose-700">{formatCurrency(totals.totalSpent)}</div>
        </div>
      </div>

      <div className="mb-4 card">
        <div className="flex gap-2">
          <input
            className="input max-w-md"
            placeholder="Search supplier by name/contact/location"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn-secondary" onClick={() => void load()}>
            Search
          </button>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Contact</th>
              <th>Location</th>
              <th>Linked Items</th>
              <th>Purchases</th>
              <th>Total Spent</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="font-medium">{row.name}</div>
                    <div className="text-xs text-slate-500">{row.isActive ? 'Active' : 'Inactive'}</div>
                  </td>
                  <td>
                    <div>{row.contactPerson || '-'}</div>
                    <div className="text-xs text-slate-500">{row.phone || '-'} | {row.email || '-'}</div>
                  </td>
                  <td>{row.address || '-'}</td>
                  <td>{row.linkedItemCount || 0}</td>
                  <td>
                    {row.purchaseCount || 0}
                    <div className="text-xs text-slate-500">Last: {formatDate(row.lastPurchaseDate)}</div>
                  </td>
                  <td>{formatCurrency(row.totalSpent || 0)}</td>
                  <td>
                    <div className="flex gap-1">
                      <button className="btn-secondary" onClick={() => void openDetails(row.id)}>
                        Details
                      </button>
                      <button className="btn-secondary" onClick={() => openEdit(row)}>
                        Edit
                      </button>
                      <button className="btn-danger" onClick={() => setDeleteId(row.id)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="text-center text-slate-500">
                  No suppliers found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={openForm} onClose={() => setOpenForm(false)} title={editing ? 'Edit Supplier' : 'Add Supplier'} width="max-w-3xl">
        <form className="grid grid-cols-1 gap-3 md:grid-cols-2" onSubmit={submit}>
          <div>
            <label className="mb-1 block text-sm">Supplier Name *</label>
            <input className="input" value={form.name || ''} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
          </div>
          <div>
            <label className="mb-1 block text-sm">Contact Person</label>
            <input
              className="input"
              value={form.contactPerson || ''}
              onChange={(e) => setForm((p) => ({ ...p, contactPerson: e.target.value }))}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm">Phone</label>
            <input className="input" value={form.phone || ''} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
          </div>
          <div>
            <label className="mb-1 block text-sm">Email</label>
            <input
              className="input"
              type="email"
              value={form.email || ''}
              onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
            />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm">Location / Address</label>
            <input className="input" value={form.address || ''} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm">Notes</label>
            <textarea className="textarea" rows={3} value={form.notes || ''} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
          </div>
          <label className="inline-flex items-center gap-2 text-sm md:col-span-2">
            <input
              type="checkbox"
              checked={Boolean(form.isActive)}
              onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked ? 1 : 0 }))}
            />
            Active supplier
          </label>
          <div className="md:col-span-2 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setOpenForm(false)}>
              Cancel
            </button>
            <button className="btn-primary">{editing ? 'Update' : 'Create'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={detailsOpen} onClose={() => setDetailsOpen(false)} title="Supplier Details" width="max-w-6xl">
        {!details ? (
          <div className="py-6 text-center text-slate-500">Loading...</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs uppercase tracking-wide text-slate-500">Supplier</div>
                <div className="text-lg font-semibold text-slate-900">{details.supplier.name}</div>
                <div className="text-xs text-slate-500">{details.supplier.contactPerson || '-'}</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs uppercase tracking-wide text-slate-500">Linked Items</div>
                <div className="text-lg font-semibold text-slate-900">{details.summary.linkedItemCount}</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs uppercase tracking-wide text-slate-500">Purchase Records</div>
                <div className="text-lg font-semibold text-slate-900">{details.summary.purchaseCount}</div>
                <div className="text-xs text-slate-500">Last: {formatDate(details.summary.lastPurchaseDate)}</div>
              </div>
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                <div className="text-xs uppercase tracking-wide text-rose-700">Total Spend</div>
                <div className="text-lg font-semibold text-rose-800">{formatCurrency(details.summary.totalSpent)}</div>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 p-3">
              <div className="mb-2 text-sm font-semibold">Record Supplier Purchase / Spend</div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs text-slate-500">Inventory Item (optional)</label>
                  <select className="select" value={spendItemId} onChange={(e) => setSpendItemId(Number(e.target.value))}>
                    <option value={0}>General purchase</option>
                    {inventory.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} ({item.sku})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Purchase Date</label>
                  <input className="input" type="date" value={spendDate} onChange={(e) => setSpendDate(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Qty</label>
                  <input className="input" type="number" min="0" step="0.01" value={spendQty} onChange={(e) => setSpendQty(Number(e.target.value))} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Unit Cost</label>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={spendUnitCost}
                    onChange={(e) => setSpendUnitCost(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Amount (LKR)</label>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={spendAmount}
                    onChange={(e) => setSpendAmount(Number(e.target.value))}
                    placeholder={computedAmount > 0 ? String(computedAmount) : ''}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Reference</label>
                  <input className="input" value={spendRef} onChange={(e) => setSpendRef(e.target.value)} placeholder="PO/GRN No" />
                </div>
                <div className="md:col-span-4">
                  <label className="mb-1 block text-xs text-slate-500">Notes</label>
                  <input className="input" value={spendNotes} onChange={(e) => setSpendNotes(e.target.value)} />
                </div>
                <div className="md:col-span-2 flex items-end">
                  <button className="btn-primary w-full" onClick={() => void saveSpend()}>
                    Record Spend
                  </button>
                </div>
              </div>
              {computedAmount > 0 ? (
                <div className="mt-2 text-xs text-slate-500">Calculated amount from qty x unit cost: {formatCurrency(computedAmount)}</div>
              ) : null}
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="mb-2 text-sm font-semibold">Items Bought From This Supplier</div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>SKU</th>
                        <th>Stock</th>
                        <th>Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {details.items.length ? (
                        details.items.map((item) => (
                          <tr key={item.id}>
                            <td>{item.name}</td>
                            <td>{item.sku}</td>
                            <td>{item.quantityInStock}</td>
                            <td>{formatCurrency(item.costPrice)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={4} className="text-center text-slate-500">
                            No linked inventory items yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 p-3">
                <div className="mb-2 text-sm font-semibold">Spend History</div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Item</th>
                        <th>Amount</th>
                        <th>Ref</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {details.spends.length ? (
                        details.spends.map((spend) => (
                          <tr key={spend.id}>
                            <td>{formatDate(spend.purchaseDate)}</td>
                            <td>{spend.itemName || 'General purchase'}</td>
                            <td>{formatCurrency(spend.amount)}</td>
                            <td>{spend.referenceNo || '-'}</td>
                            <td>
                              <button className="btn-danger" onClick={() => setDeletingSpendId(spend.id)}>
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={5} className="text-center text-slate-500">
                            No spend records yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={deleteId !== null}
        title="Delete Supplier"
        message="Are you sure you want to delete this supplier?"
        onCancel={() => setDeleteId(null)}
        onConfirm={() => void remove()}
        confirmLabel="Delete"
      />

      <ConfirmDialog
        open={deletingSpendId !== null}
        title="Delete Spend Record"
        message="Delete this supplier spend record?"
        onCancel={() => setDeletingSpendId(null)}
        onConfirm={() => void deleteSpend()}
        confirmLabel="Delete"
      />
    </div>
  );
};
