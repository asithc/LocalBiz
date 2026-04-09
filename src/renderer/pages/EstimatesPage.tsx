import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PdfPreviewModal } from '../components/PdfPreviewModal';
import { WorkflowSteps } from '../components/WorkflowSteps';
import { apiRequest, exportModule } from '../lib/api';
import { useUiStore } from '../store/uiStore';
import { calculateDiscount, formatCurrency, formatDate, sumBy } from '../utils/format';
import { BRAND } from '@shared/branding';

type DiscountType = 'NONE' | 'PERCENTAGE' | 'FIXED';
type EstimateStatus = 'Draft' | 'Sent' | 'Approved' | 'Rejected' | 'Converted';

interface CustomerOption {
  id: number;
  name: string;
}

interface InventoryOption {
  id: number;
  name: string;
  sellingPrice: number;
  effectiveSellingPrice?: number;
  itemDiscountType?: 'NONE' | 'PERCENTAGE' | 'FIXED';
  itemDiscountValue?: number;
}

interface EstimateRow {
  id: number;
  estimateNumber: string;
  customerId: number;
  customerName: string;
  issueDate: string;
  status: EstimateStatus;
  discountType: DiscountType;
  discountValue: number;
  subtotal: number;
  totalDiscount: number;
  grandTotal: number;
  notes?: string;
  terms?: string;
}

interface EstimateItemForm {
  inventoryItemId?: number;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
}

const statuses: EstimateStatus[] = ['Draft', 'Sent', 'Approved', 'Rejected', 'Converted'];

const blankItem = (): EstimateItemForm => ({
  description: '',
  quantity: 1,
  unitPrice: 0,
  discount: 0
});

export const EstimatesPage = () => {
  const notify = useUiStore((s) => s.notify);
  const navigate = useNavigate();

  const [rows, setRows] = useState<EstimateRow[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [inventory, setInventory] = useState<InventoryOption[]>([]);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const [openForm, setOpenForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDataUrl, setPreviewDataUrl] = useState('');

  const [customerId, setCustomerId] = useState<number>(0);
  const [issueDate, setIssueDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState<EstimateStatus>('Draft');
  const [discountType, setDiscountType] = useState<DiscountType>('NONE');
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('');
  const [items, setItems] = useState<EstimateItemForm[]>([blankItem()]);

  const subtotal = useMemo(
    () =>
      sumBy(items, (item) => {
        const line = Number(item.quantity || 0) * Number(item.unitPrice || 0) - Number(item.discount || 0);
        return line > 0 ? line : 0;
      }),
    [items]
  );

  const totals = useMemo(() => {
    try {
      return calculateDiscount(subtotal, discountType, discountValue);
    } catch {
      return { subtotal, discount: 0, total: subtotal };
    }
  }, [subtotal, discountType, discountValue]);

  const resetForm = () => {
    setEditingId(null);
    setCustomerId(0);
    setIssueDate(new Date().toISOString().slice(0, 10));
    setStatus('Draft');
    setDiscountType('NONE');
    setDiscountValue(0);
    setNotes('');
    setTerms('');
    setItems([blankItem()]);
  };

  const load = async () => {
    const [estimateRows, meta] = await Promise.all([
      apiRequest<EstimateRow[]>('estimates/list', { search, status: statusFilter }),
      apiRequest<{ customers: CustomerOption[]; inventory: InventoryOption[] }>('meta/options')
    ]);

    setRows(estimateRows);
    setCustomers(meta.customers || []);
    setInventory(meta.inventory || []);
  };

  useEffect(() => {
    void load();
  }, []);

  const openCreate = () => {
    resetForm();
    setOpenForm(true);
  };

  const openEdit = async (id: number) => {
    try {
      const data = await apiRequest<any>('estimates/get', { id });
      setEditingId(id);
      setCustomerId(Number(data.customerId));
      setIssueDate(data.issueDate || new Date().toISOString().slice(0, 10));
      setStatus(data.status as EstimateStatus);
      setDiscountType(data.discountType as DiscountType);
      setDiscountValue(Number(data.discountValue || 0));
      setNotes(data.notes || '');
      setTerms(data.terms || '');
      setItems(
        (data.items || []).map((item: any) => ({
          inventoryItemId: item.inventoryItemId || undefined,
          description: item.description,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          discount: Number(item.discount || 0)
        }))
      );
      setOpenForm(true);
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const addItem = () => setItems((prev) => [...prev, blankItem()]);

  const updateItem = (idx: number, patch: Partial<EstimateItemForm>) => {
    setItems((prev) => prev.map((item, i) => (i === idx ? { ...item, ...patch } : item)));
  };

  const removeItem = (idx: number) => {
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));
  };

  const onSelectInventory = (idx: number, itemId: number) => {
    const selected = inventory.find((x) => x.id === itemId);
    if (!selected) return;
    updateItem(idx, {
      inventoryItemId: selected.id,
      description: selected.name,
      unitPrice: Number(selected.effectiveSellingPrice ?? selected.sellingPrice ?? 0)
    });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      if (!customerId) throw new Error('Customer is required.');
      if (!items.length) throw new Error('Add at least one line item.');

      items.forEach((item, idx) => {
        if (!item.description.trim()) throw new Error(`Item ${idx + 1} description is required.`);
        if (Number(item.quantity) <= 0) throw new Error(`Item ${idx + 1} quantity must be greater than 0.`);
        if (Number(item.unitPrice) < 0) throw new Error(`Item ${idx + 1} unit price cannot be negative.`);
      });

      const payload = {
        customerId,
        issueDate,
        status,
        discountType,
        discountValue,
        notes,
        terms,
        items
      };

      if (editingId) {
        await apiRequest('estimates/update', { id: editingId, data: payload });
        notify('success', 'Estimate updated.');
      } else {
        await apiRequest('estimates/create', payload);
        notify('success', 'Estimate created.');
      }

      setOpenForm(false);
      resetForm();
      await load();
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const removeEstimate = async () => {
    if (!deleteId) return;
    try {
      await apiRequest('estimates/delete', { id: deleteId });
      notify('success', 'Estimate deleted.');
      setDeleteId(null);
      await load();
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const updateStatus = async (id: number, next: EstimateStatus) => {
    try {
      await apiRequest('estimates/status', { id, status: next });
      notify('success', `Estimate marked as ${next}.`);
      await load();
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const convertToJob = async (id: number) => {
    try {
      const res = await apiRequest<{ jobId: number; jobCode: string; alreadyExists?: boolean }>('estimates/convert', { id });
      notify('success', res.alreadyExists ? `Already converted: ${res.jobCode}` : `Converted to job ${res.jobCode}`);
      navigate(`/jobs?jobId=${res.jobId}`);
      await load();
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const exportPdf = async (id: number) => {
    try {
      const res = await apiRequest<{ canceled: boolean; filePath?: string }>('pdf/generate', { type: 'estimate', id });
      if (!res.canceled) notify('success', `PDF saved to ${res.filePath}`);
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const previewPdf = async (id: number) => {
    try {
      const res = await apiRequest<{ dataUrl: string }>('pdf/preview', { type: 'estimate', id });
      setPreviewDataUrl(res.dataUrl);
      setPreviewOpen(true);
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const printDocument = async (id: number) => {
    try {
      await apiRequest('pdf/print', { type: 'estimate', id });
      notify('success', 'Print dialog opened for estimate.');
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const composeEmail = async (id: number) => {
    try {
      await apiRequest('mail/compose', { template: 'estimate', id });
      notify('success', 'Opened default mail client with estimate template.');
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const runExport = async (format: 'xlsx' | 'csv') => {
    try {
      const res = await exportModule('estimates', format);
      if (!res.canceled) notify('success', `Estimates exported to ${res.filePath}`);
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const totalEstimateValue = useMemo(() => sumBy(rows, (r) => Number(r.grandTotal || 0)), [rows]);
  const approvedCount = useMemo(() => rows.filter((r) => r.status === 'Approved').length, [rows]);

  return (
    <div>
      <PageHeader
        title="Estimates / Quotations"
        subtitle="Step 1 of 3: create and approve estimate before starting the job"
        actions={
          <>
            <button className="btn-secondary" onClick={() => runExport('xlsx')}>
              Export XLSX
            </button>
            <button className="btn-secondary" onClick={() => runExport('csv')}>
              Export CSV
            </button>
            <button className="btn-primary" onClick={openCreate}>
              New Estimate
            </button>
          </>
        }
      />
      <WorkflowSteps currentStep={1} />

      <div className="mb-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <img src={BRAND.logoBanner} alt="Jayakula Brothers branding" className="h-10 w-full object-cover" />
        <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-3">
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Estimate Count</div>
            <div className="text-lg font-semibold text-slate-900">{rows.length}</div>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Approved</div>
            <div className="text-lg font-semibold text-emerald-700">{approvedCount}</div>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Total Value</div>
            <div className="text-lg font-semibold text-brand-700">{formatCurrency(totalEstimateValue)}</div>
          </div>
        </div>
      </div>

      <div className="mb-4 card">
        <div className="flex flex-wrap gap-2">
          <input
            className="input max-w-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search estimate/customer"
          />
          <select className="select max-w-xs" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="ALL">All Status</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button className="btn-secondary" onClick={load}>
            Apply
          </button>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Estimate #</th>
              <th>Customer</th>
              <th>Date</th>
              <th>Status</th>
              <th>Total</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.id}>
                  <td className="font-medium">{row.estimateNumber}</td>
                  <td>{row.customerName}</td>
                  <td>{formatDate(row.issueDate)}</td>
                  <td>
                    <select className="select h-8" value={row.status} onChange={(e) => void updateStatus(row.id, e.target.value as EstimateStatus)}>
                      {statuses.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{formatCurrency(row.grandTotal)}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      <button className="btn-secondary" onClick={() => void openEdit(row.id)}>
                        Edit
                      </button>
                      <button className="btn-secondary" onClick={() => void previewPdf(row.id)}>
                        View
                      </button>
                      <button className="btn-secondary" onClick={() => void exportPdf(row.id)}>
                        PDF
                      </button>
                      <button className="btn-secondary" onClick={() => void printDocument(row.id)}>
                        Print
                      </button>
                      <button className="btn-secondary" onClick={() => void composeEmail(row.id)}>
                        Email
                      </button>
                      <button
                        className={row.status === 'Approved' || row.status === 'Converted' ? 'btn-primary' : 'btn-secondary opacity-60'}
                        disabled={row.status !== 'Approved' && row.status !== 'Converted'}
                        onClick={() => void convertToJob(row.id)}
                        title={
                          row.status === 'Approved' || row.status === 'Converted'
                            ? 'Create/open job from this estimate'
                            : 'Approve estimate first'
                        }
                      >
                        Step 2: Start Job
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
                <td colSpan={6} className="text-center text-slate-500">
                  No estimates found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={openForm} onClose={() => setOpenForm(false)} title={editingId ? 'Edit Estimate' : 'New Estimate'}>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm">Customer *</label>
              <select className="select" value={customerId} onChange={(e) => setCustomerId(Number(e.target.value))}>
                <option value={0}>Select customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm">Issue Date</label>
              <input className="input" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm">Status</label>
              <select className="select" value={status} onChange={(e) => setStatus(e.target.value as EstimateStatus)}>
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">Line Items</h3>
              <button type="button" className="btn-secondary" onClick={addItem}>
                Add Line
              </button>
            </div>

            {items.map((item, idx) => (
              <div key={idx} className="grid grid-cols-1 gap-2 rounded-md border border-slate-200 p-2 md:grid-cols-12">
                <div className="md:col-span-3">
                  <label className="mb-1 block text-xs text-slate-500">Inventory Item</label>
                  <select
                    className="select"
                    value={item.inventoryItemId || 0}
                    onChange={(e) => onSelectInventory(idx, Number(e.target.value))}
                  >
                    <option value={0}>Custom/service item</option>
                    {inventory.map((inv) => (
                      <option key={inv.id} value={inv.id}>
                        {inv.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-3">
                  <label className="mb-1 block text-xs text-slate-500">Description *</label>
                  <input
                    className="input"
                    value={item.description}
                    onChange={(e) => updateItem(idx, { description: e.target.value })}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs text-slate-500">Qty *</label>
                  <input
                    className="input"
                    type="number"
                    min="1"
                    step="1"
                    value={item.quantity}
                    onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) })}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs text-slate-500">Unit Price *</label>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.unitPrice}
                    onChange={(e) => updateItem(idx, { unitPrice: Number(e.target.value) })}
                  />
                </div>
                <div className="md:col-span-1">
                  <label className="mb-1 block text-xs text-slate-500">Disc</label>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.discount}
                    onChange={(e) => updateItem(idx, { discount: Number(e.target.value) })}
                  />
                </div>
                <div className="md:col-span-1 flex items-end">
                  <button type="button" className="btn-danger w-full" onClick={() => removeItem(idx)}>
                    X
                  </button>
                </div>
                <div className="md:col-span-12 text-right text-xs text-slate-500">
                  Line total: {formatCurrency(item.quantity * item.unitPrice - item.discount)}
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm">Discount Type</label>
              <select className="select" value={discountType} onChange={(e) => setDiscountType(e.target.value as DiscountType)}>
                <option value="NONE">None</option>
                <option value="PERCENTAGE">Percentage</option>
                <option value="FIXED">Fixed Amount</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm">Discount Value</label>
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                value={discountValue}
                onChange={(e) => setDiscountValue(Number(e.target.value))}
              />
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <div>Subtotal: {formatCurrency(totals.subtotal)}</div>
              <div>Discount: {formatCurrency(totals.discount)}</div>
              <div className="font-semibold">Grand Total: {formatCurrency(totals.total)}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm">Notes</label>
              <textarea className="textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm">Terms</label>
              <textarea className="textarea" rows={3} value={terms} onChange={(e) => setTerms(e.target.value)} />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setOpenForm(false)}>
              Cancel
            </button>
            <button className="btn-primary">{editingId ? 'Update Estimate' : 'Create Estimate'}</button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={deleteId !== null}
        title="Delete Estimate"
        message="Delete this estimate permanently?"
        onCancel={() => setDeleteId(null)}
        onConfirm={() => void removeEstimate()}
        confirmLabel="Delete"
      />

      <PdfPreviewModal
        open={previewOpen}
        title="Estimate Preview"
        dataUrl={previewDataUrl}
        onClose={() => {
          setPreviewOpen(false);
          setPreviewDataUrl('');
        }}
      />
    </div>
  );
};
