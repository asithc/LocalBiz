import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
type PaymentStatus = 'Unpaid' | 'Partially Paid' | 'Paid';
type PaymentMethod = 'Cash' | 'Bank Transfer' | 'Card' | 'Other';

interface InvoiceRow {
  id: number;
  invoiceNumber: string;
  customerName: string;
  jobCode: string;
  issueDate: string;
  dueDate?: string;
  paymentStatus: PaymentStatus;
  paymentMethod?: PaymentMethod;
  total: number;
  subtotal: number;
  discountAmount: number;
}

interface JobOption {
  id: number;
  jobCode: string;
  title: string;
  status: string;
}

interface InvoiceItem {
  id?: number;
  description: string;
  quantity: number;
  unitPrice: number;
  sourceType?: string;
  sourceId?: number;
}

const paymentStatuses: PaymentStatus[] = ['Unpaid', 'Partially Paid', 'Paid'];
const paymentMethods: PaymentMethod[] = ['Cash', 'Bank Transfer', 'Card', 'Other'];

export const InvoicesPage = () => {
  const notify = useUiStore((s) => s.notify);
  const [searchParams, setSearchParams] = useSearchParams();

  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [jobs, setJobs] = useState<JobOption[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const [openCreate, setOpenCreate] = useState(false);
  const [createJobId, setCreateJobId] = useState<number>(0);
  const [createIssueDate, setCreateIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [createDueDate, setCreateDueDate] = useState('');
  const [createDiscountType, setCreateDiscountType] = useState<DiscountType>('NONE');
  const [createDiscountValue, setCreateDiscountValue] = useState<number>(0);
  const [createPaymentStatus, setCreatePaymentStatus] = useState<PaymentStatus>('Unpaid');
  const [createPaymentMethod, setCreatePaymentMethod] = useState<PaymentMethod>('Cash');
  const [createNotes, setCreateNotes] = useState('');
  const [extraItems, setExtraItems] = useState<InvoiceItem[]>([]);

  const [openEdit, setOpenEdit] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editData, setEditData] = useState<any>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDataUrl, setPreviewDataUrl] = useState('');
  const [workflowPrefillHandled, setWorkflowPrefillHandled] = useState(false);

  const load = async () => {
    const [invoices, meta] = await Promise.all([
      apiRequest<InvoiceRow[]>('invoices/list', { search, status: statusFilter }),
      apiRequest<{ jobs: JobOption[] }>('meta/options')
    ]);
    setRows(invoices);
    setJobs((meta.jobs || []).filter((j) => j.status === 'Completed'));
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (workflowPrefillHandled) return;

    const jobIdFromFlow = Number(searchParams.get('jobId') || 0);
    if (!jobIdFromFlow) {
      setWorkflowPrefillHandled(true);
      return;
    }

    if (!jobs.length) return;

    const matched = jobs.find((j) => j.id === jobIdFromFlow);
    if (!matched) {
      notify('error', 'Selected job is not ready for invoicing. Complete the job first.');
      setWorkflowPrefillHandled(true);
      const next = new URLSearchParams(searchParams);
      next.delete('jobId');
      setSearchParams(next, { replace: true });
      return;
    }

    setCreateJobId(jobIdFromFlow);
    setOpenCreate(true);
    setWorkflowPrefillHandled(true);
    const next = new URLSearchParams(searchParams);
    next.delete('jobId');
    setSearchParams(next, { replace: true });
  }, [jobs, notify, searchParams, setSearchParams, workflowPrefillHandled]);

  const resetCreate = () => {
    setCreateJobId(0);
    setCreateIssueDate(new Date().toISOString().slice(0, 10));
    setCreateDueDate('');
    setCreateDiscountType('NONE');
    setCreateDiscountValue(0);
    setCreatePaymentStatus('Unpaid');
    setCreatePaymentMethod('Cash');
    setCreateNotes('');
    setExtraItems([]);
  };

  const createInvoice = async (e: FormEvent) => {
    e.preventDefault();
    try {
      if (!createJobId) throw new Error('Select a completed job.');
      const res = await apiRequest<{ invoiceNumber: string; alreadyExists?: boolean }>('invoices/create-from-job', {
        jobId: createJobId,
        issueDate: createIssueDate,
        dueDate: createDueDate || null,
        discountType: createDiscountType,
        discountValue: createDiscountValue,
        paymentStatus: createPaymentStatus,
        paymentMethod: createPaymentMethod,
        notes: createNotes,
        extraItems: extraItems.filter((i) => i.description.trim() && i.quantity > 0)
      });

      notify('success', res.alreadyExists ? `Invoice already exists: ${res.invoiceNumber}` : `Invoice created: ${res.invoiceNumber}`);
      setOpenCreate(false);
      resetCreate();
      await load();
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const openInvoiceEdit = async (id: number) => {
    try {
      const data = await apiRequest<any>('invoices/get', { id });
      setEditingId(id);
      setEditData({
        issueDate: data.issueDate,
        dueDate: data.dueDate || '',
        discountType: data.discountType as DiscountType,
        discountValue: Number(data.discountValue || 0),
        paymentStatus: data.paymentStatus as PaymentStatus,
        paymentMethod: (data.paymentMethod as PaymentMethod) || 'Cash',
        notes: data.notes || '',
        items: (data.items || []).map((item: any) => ({
          id: item.id,
          description: item.description,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          sourceType: item.sourceType,
          sourceId: item.sourceId
        }))
      });
      setOpenEdit(true);
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const editSubtotal = useMemo(() => {
    if (!editData?.items) return 0;
    return sumBy(editData.items, (i: InvoiceItem) => Number(i.quantity || 0) * Number(i.unitPrice || 0));
  }, [editData]);

  const editTotals = useMemo(() => {
    if (!editData) return { subtotal: 0, discount: 0, total: 0 };
    try {
      return calculateDiscount(editSubtotal, editData.discountType, editData.discountValue);
    } catch {
      return { subtotal: editSubtotal, discount: 0, total: editSubtotal };
    }
  }, [editData, editSubtotal]);

  const saveEditedInvoice = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingId || !editData) return;

    try {
      await apiRequest('invoices/update', {
        id: editingId,
        data: {
          issueDate: editData.issueDate,
          dueDate: editData.dueDate || null,
          discountType: editData.discountType,
          discountValue: editData.discountValue,
          paymentStatus: editData.paymentStatus,
          paymentMethod: editData.paymentMethod,
          notes: editData.notes,
          items: editData.items
        }
      });
      notify('success', 'Invoice updated.');
      setOpenEdit(false);
      setEditingId(null);
      await load();
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const updatePaymentStatus = async (id: number, paymentStatus: PaymentStatus) => {
    try {
      await apiRequest('invoices/payment-status', { invoiceId: id, paymentStatus });
      notify('success', `Payment status changed to ${paymentStatus}.`);
      await load();
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const removeInvoice = async () => {
    if (!deleteId) return;
    try {
      await apiRequest('invoices/delete', { id: deleteId });
      notify('success', 'Invoice deleted.');
      setDeleteId(null);
      await load();
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const exportPdf = async (id: number) => {
    try {
      const res = await apiRequest<{ canceled: boolean; filePath?: string }>('pdf/generate', { type: 'invoice', id });
      if (!res.canceled) notify('success', `Invoice PDF saved to ${res.filePath}`);
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const previewPdf = async (id: number) => {
    try {
      const res = await apiRequest<{ dataUrl: string }>('pdf/preview', { type: 'invoice', id });
      setPreviewDataUrl(res.dataUrl);
      setPreviewOpen(true);
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const printDocument = async (id: number) => {
    try {
      await apiRequest('pdf/print', { type: 'invoice', id });
      notify('success', 'Print dialog opened for invoice.');
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const composeEmail = async (id: number) => {
    try {
      await apiRequest('mail/compose', { template: 'invoice', id });
      notify('success', 'Opened default mail client with invoice email template.');
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const runExport = async (format: 'xlsx' | 'csv') => {
    try {
      const res = await exportModule('invoices', format);
      if (!res.canceled) notify('success', `Invoices exported to ${res.filePath}`);
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const totalInvoiced = useMemo(() => sumBy(rows, (r) => Number(r.total || 0)), [rows]);
  const unpaidCount = useMemo(() => rows.filter((r) => r.paymentStatus !== 'Paid').length, [rows]);

  return (
    <div>
      <PageHeader
        title="Invoices"
        subtitle="Step 3 of 3: generate invoice from completed job"
        actions={
          <>
            <button className="btn-secondary" onClick={() => runExport('xlsx')}>Export XLSX</button>
            <button className="btn-secondary" onClick={() => runExport('csv')}>Export CSV</button>
            <button className="btn-primary" onClick={() => setOpenCreate(true)}>Step 3: Generate From Job</button>
          </>
        }
      />
      <WorkflowSteps currentStep={3} />

      <div className="mb-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <img src={BRAND.logoBanner} alt="Jayakula Brothers branding" className="h-10 w-full object-cover" />
        <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-3">
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Invoice Count</div>
            <div className="text-lg font-semibold text-slate-900">{rows.length}</div>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Pending Payments</div>
            <div className="text-lg font-semibold text-amber-700">{unpaidCount}</div>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">Total Invoiced</div>
            <div className="text-lg font-semibold text-brand-700">{formatCurrency(totalInvoiced)}</div>
          </div>
        </div>
      </div>

      <div className="mb-4 card">
        <div className="flex flex-wrap gap-2">
          <input className="input max-w-xs" placeholder="Search invoice/job/customer" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="select max-w-xs" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="ALL">All Status</option>
            {paymentStatuses.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button className="btn-secondary" onClick={load}>Apply</button>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Invoice #</th>
              <th>Customer</th>
              <th>Job</th>
              <th>Date</th>
              <th>Total</th>
              <th>Payment</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.id}>
                  <td className="font-medium">{row.invoiceNumber}</td>
                  <td>{row.customerName}</td>
                  <td>{row.jobCode}</td>
                  <td>{formatDate(row.issueDate)}</td>
                  <td>{formatCurrency(row.total)}</td>
                  <td>
                    <select className="select h-8" value={row.paymentStatus} onChange={(e) => void updatePaymentStatus(row.id, e.target.value as PaymentStatus)}>
                      {paymentStatuses.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      <button className="btn-secondary" onClick={() => void openInvoiceEdit(row.id)}>Edit</button>
                      <button className="btn-secondary" onClick={() => void previewPdf(row.id)}>View</button>
                      <button className="btn-secondary" onClick={() => void exportPdf(row.id)}>PDF</button>
                      <button className="btn-secondary" onClick={() => void printDocument(row.id)}>Print</button>
                      <button className="btn-secondary" onClick={() => void composeEmail(row.id)}>Email</button>
                      <button className="btn-danger" onClick={() => setDeleteId(row.id)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="text-center text-slate-500">No invoices found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={openCreate} onClose={() => setOpenCreate(false)} title="Generate Invoice From Completed Job">
        <form onSubmit={createInvoice} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm">Completed Job *</label>
              <select className="select" value={createJobId} onChange={(e) => setCreateJobId(Number(e.target.value))}>
                <option value={0}>Select completed job</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>{j.jobCode} - {j.title}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm">Issue Date</label>
              <input className="input" type="date" value={createIssueDate} onChange={(e) => setCreateIssueDate(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm">Due Date</label>
              <input className="input" type="date" value={createDueDate} onChange={(e) => setCreateDueDate(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm">Discount Type</label>
              <select className="select" value={createDiscountType} onChange={(e) => setCreateDiscountType(e.target.value as DiscountType)}>
                <option value="NONE">None</option>
                <option value="PERCENTAGE">Percentage</option>
                <option value="FIXED">Fixed</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm">Discount Value</label>
              <input className="input" type="number" min="0" step="0.01" value={createDiscountValue} onChange={(e) => setCreateDiscountValue(Number(e.target.value))} />
            </div>
            <div>
              <label className="mb-1 block text-sm">Payment Status</label>
              <select className="select" value={createPaymentStatus} onChange={(e) => setCreatePaymentStatus(e.target.value as PaymentStatus)}>
                {paymentStatuses.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm">Payment Method</label>
              <select className="select" value={createPaymentMethod} onChange={(e) => setCreatePaymentMethod(e.target.value as PaymentMethod)}>
                {paymentMethods.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-3">
              <label className="mb-1 block text-sm">Notes</label>
              <textarea className="textarea" rows={2} value={createNotes} onChange={(e) => setCreateNotes(e.target.value)} />
            </div>
          </div>

          <div className="rounded-md border border-slate-200 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-medium">Optional Extra Service Items</h3>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setExtraItems((prev) => [...prev, { description: '', quantity: 1, unitPrice: 0 }])}
              >
                Add Extra Line
              </button>
            </div>
            <div className="space-y-2">
              {extraItems.map((item, idx) => (
                <div key={idx} className="grid grid-cols-1 gap-2 md:grid-cols-12">
                  <input
                    className="input md:col-span-6"
                    placeholder="Description"
                    value={item.description}
                    onChange={(e) =>
                      setExtraItems((prev) => prev.map((x, i) => (i === idx ? { ...x, description: e.target.value } : x)))
                    }
                  />
                  <input
                    className="input md:col-span-2"
                    type="number"
                    min="1"
                    value={item.quantity}
                    onChange={(e) =>
                      setExtraItems((prev) => prev.map((x, i) => (i === idx ? { ...x, quantity: Number(e.target.value) } : x)))
                    }
                  />
                  <input
                    className="input md:col-span-3"
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.unitPrice}
                    onChange={(e) =>
                      setExtraItems((prev) => prev.map((x, i) => (i === idx ? { ...x, unitPrice: Number(e.target.value) } : x)))
                    }
                  />
                  <button
                    type="button"
                    className="btn-danger md:col-span-1"
                    onClick={() => setExtraItems((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    X
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setOpenCreate(false)}>Cancel</button>
            <button className="btn-primary">Generate Invoice</button>
          </div>
        </form>
      </Modal>

      <Modal open={openEdit} onClose={() => setOpenEdit(false)} title="Edit Invoice">
        {!editData ? null : (
          <form onSubmit={saveEditedInvoice} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm">Issue Date</label>
                <input className="input" type="date" value={editData.issueDate} onChange={(e) => setEditData((p: any) => ({ ...p, issueDate: e.target.value }))} />
              </div>
              <div>
                <label className="mb-1 block text-sm">Due Date</label>
                <input className="input" type="date" value={editData.dueDate} onChange={(e) => setEditData((p: any) => ({ ...p, dueDate: e.target.value }))} />
              </div>
              <div>
                <label className="mb-1 block text-sm">Payment Status</label>
                <select className="select" value={editData.paymentStatus} onChange={(e) => setEditData((p: any) => ({ ...p, paymentStatus: e.target.value }))}>
                  {paymentStatuses.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm">Payment Method</label>
                <select className="select" value={editData.paymentMethod} onChange={(e) => setEditData((p: any) => ({ ...p, paymentMethod: e.target.value }))}>
                  {paymentMethods.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm">Discount Type</label>
                <select className="select" value={editData.discountType} onChange={(e) => setEditData((p: any) => ({ ...p, discountType: e.target.value }))}>
                  <option value="NONE">None</option>
                  <option value="PERCENTAGE">Percentage</option>
                  <option value="FIXED">Fixed</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm">Discount Value</label>
                <input className="input" type="number" min="0" step="0.01" value={editData.discountValue} onChange={(e) => setEditData((p: any) => ({ ...p, discountValue: Number(e.target.value) }))} />
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Description</th>
                    <th>Qty</th>
                    <th>Unit Price</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {editData.items.map((item: InvoiceItem, idx: number) => (
                    <tr key={idx}>
                      <td>
                        <input
                          className="input"
                          value={item.description}
                          onChange={(e) =>
                            setEditData((p: any) => ({
                              ...p,
                              items: p.items.map((x: InvoiceItem, i: number) =>
                                i === idx ? { ...x, description: e.target.value } : x
                              )
                            }))
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="input"
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) =>
                            setEditData((p: any) => ({
                              ...p,
                              items: p.items.map((x: InvoiceItem, i: number) =>
                                i === idx ? { ...x, quantity: Number(e.target.value) } : x
                              )
                            }))
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="input"
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.unitPrice}
                          onChange={(e) =>
                            setEditData((p: any) => ({
                              ...p,
                              items: p.items.map((x: InvoiceItem, i: number) =>
                                i === idx ? { ...x, unitPrice: Number(e.target.value) } : x
                              )
                            }))
                          }
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn-danger"
                          onClick={() =>
                            setEditData((p: any) => ({ ...p, items: p.items.filter((_: InvoiceItem, i: number) => i !== idx) }))
                          }
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              className="btn-secondary"
              onClick={() =>
                setEditData((p: any) => ({ ...p, items: [...p.items, { description: '', quantity: 1, unitPrice: 0 }] }))
              }
            >
              Add Line
            </button>

            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <div>Subtotal: {formatCurrency(editTotals.subtotal)}</div>
              <div>Discount: {formatCurrency(editTotals.discount)}</div>
              <div className="font-semibold">Total: {formatCurrency(editTotals.total)}</div>
            </div>

            <div>
              <label className="mb-1 block text-sm">Notes</label>
              <textarea className="textarea" rows={2} value={editData.notes} onChange={(e) => setEditData((p: any) => ({ ...p, notes: e.target.value }))} />
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setOpenEdit(false)}>Cancel</button>
              <button className="btn-primary">Save Invoice</button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={deleteId !== null}
        title="Delete Invoice"
        message="Delete this invoice permanently?"
        onCancel={() => setDeleteId(null)}
        onConfirm={() => void removeInvoice()}
        confirmLabel="Delete"
      />

      <PdfPreviewModal
        open={previewOpen}
        title="Invoice Preview"
        dataUrl={previewDataUrl}
        onClose={() => {
          setPreviewOpen(false);
          setPreviewDataUrl('');
        }}
      />
    </div>
  );
};
