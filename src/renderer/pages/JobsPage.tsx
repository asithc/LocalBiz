import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PdfPreviewModal } from '../components/PdfPreviewModal';
import { WorkflowSteps } from '../components/WorkflowSteps';
import { apiRequest, exportModule } from '../lib/api';
import { useUiStore } from '../store/uiStore';
import { formatCurrency, formatDate, sumBy } from '../utils/format';

type JobStatus = 'New' | 'Scheduled' | 'In Progress' | 'On Hold' | 'Completed' | 'Cancelled';

interface JobRow {
  id: number;
  jobCode: string;
  customerId: number;
  customerName: string;
  estimateId?: number;
  title: string;
  description?: string;
  location?: string;
  plannedStartDate?: string;
  plannedEndDate?: string;
  actualCompletionDate?: string;
  status: JobStatus;
  estimatedAmount: number;
  laborCharges: number;
  extraCharges: number;
  finalAdjustments: number;
  notes?: string;
  internalRemarks?: string;
}

interface CustomerOption {
  id: number;
  name: string;
}

interface EstimateOption {
  id: number;
  estimateNumber: string;
  customerName: string;
}

interface StaffOption {
  id: number;
  name: string;
  roleTitle?: string;
}

interface InventoryOption {
  id: number;
  name: string;
  quantityInStock: number;
  sellingPrice: number;
}

interface JobItem {
  id: number;
  inventoryItemId?: number;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  allocatedFromStock: number;
}

const statuses: JobStatus[] = ['New', 'Scheduled', 'In Progress', 'On Hold', 'Completed', 'Cancelled'];

const emptyJob = {
  customerId: 0,
  estimateId: 0,
  title: '',
  description: '',
  location: '',
  plannedStartDate: '',
  plannedEndDate: '',
  actualCompletionDate: '',
  status: 'New' as JobStatus,
  estimatedAmount: 0,
  laborCharges: 0,
  extraCharges: 0,
  finalAdjustments: 0,
  notes: '',
  internalRemarks: '',
  staffIds: [] as number[]
};

export const JobsPage = () => {
  const notify = useUiStore((s) => s.notify);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const highlightedJobId = Number(searchParams.get('jobId') || 0);

  const [rows, setRows] = useState<JobRow[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [estimates, setEstimates] = useState<EstimateOption[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [inventory, setInventory] = useState<InventoryOption[]>([]);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState<JobRow | null>(null);
  const [jobForm, setJobForm] = useState(emptyJob);

  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDataUrl, setPreviewDataUrl] = useState('');

  const [itemsJobId, setItemsJobId] = useState<number | null>(null);
  const [itemsJobCode, setItemsJobCode] = useState<string>('');
  const [jobItems, setJobItems] = useState<JobItem[]>([]);
  const [serviceDesc, setServiceDesc] = useState('');
  const [serviceQty, setServiceQty] = useState(1);
  const [servicePrice, setServicePrice] = useState(0);
  const [allocateInvId, setAllocateInvId] = useState<number>(0);
  const [allocateQty, setAllocateQty] = useState<number>(1);

  const load = async () => {
    const [jobs, meta] = await Promise.all([
      apiRequest<JobRow[]>('jobs/list', { search, status: statusFilter }),
      apiRequest<{
        customers: CustomerOption[];
        estimates: EstimateOption[];
        staff: StaffOption[];
        inventory: InventoryOption[];
      }>('meta/options')
    ]);
    setRows(jobs);
    setCustomers(meta.customers || []);
    setEstimates(meta.estimates || []);
    setStaff(meta.staff || []);
    setInventory(meta.inventory || []);
  };

  useEffect(() => {
    void load();
  }, []);

  const resetJobForm = () => {
    setEditing(null);
    setJobForm(emptyJob);
  };

  const openCreate = () => {
    resetJobForm();
    setOpenForm(true);
  };

  const openEdit = async (row: JobRow) => {
    try {
      const data = await apiRequest<any>('jobs/get', { id: row.id });
      setEditing(row);
      setJobForm({
        customerId: Number(data.customerId),
        estimateId: Number(data.estimateId || 0),
        title: data.title || '',
        description: data.description || '',
        location: data.location || '',
        plannedStartDate: data.plannedStartDate || '',
        plannedEndDate: data.plannedEndDate || '',
        actualCompletionDate: data.actualCompletionDate || '',
        status: (data.status as JobStatus) || 'New',
        estimatedAmount: Number(data.estimatedAmount || 0),
        laborCharges: Number(data.laborCharges || 0),
        extraCharges: Number(data.extraCharges || 0),
        finalAdjustments: Number(data.finalAdjustments || 0),
        notes: data.notes || '',
        internalRemarks: data.internalRemarks || '',
        staffIds: (data.staff || []).map((s: any) => Number(s.id))
      });
      setOpenForm(true);
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const submitJob = async (e: FormEvent) => {
    e.preventDefault();
    try {
      if (!jobForm.customerId) throw new Error('Customer is required.');
      if (!jobForm.title.trim()) throw new Error('Job title is required.');

      const payload = {
        ...jobForm,
        estimateId: jobForm.estimateId || null
      };

      if (editing) {
        await apiRequest('jobs/update', { id: editing.id, data: payload });
        notify('success', 'Job updated.');
      } else {
        await apiRequest('jobs/create', payload);
        notify('success', 'Job created.');
      }

      setOpenForm(false);
      resetJobForm();
      await load();
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const removeJob = async () => {
    if (!deleteId) return;
    try {
      await apiRequest('jobs/delete', { id: deleteId });
      notify('success', 'Job deleted.');
      setDeleteId(null);
      await load();
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const changeStatus = async (jobId: number, status: JobStatus) => {
    try {
      await apiRequest('jobs/status', { jobId, status, actualCompletionDate: new Date().toISOString().slice(0, 10) });
      notify('success', `Job marked as ${status}.`);
      await load();
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const openItems = async (row: JobRow) => {
    try {
      const data = await apiRequest<any>('jobs/get', { id: row.id });
      setItemsJobId(row.id);
      setItemsJobCode(row.jobCode);
      setJobItems(data.items || []);
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const refreshItems = async () => {
    if (!itemsJobId) return;
    const data = await apiRequest<any>('jobs/get', { id: itemsJobId });
    setJobItems(data.items || []);
    await load();
  };

  const addServiceItem = async () => {
    if (!itemsJobId) return;
    try {
      if (!serviceDesc.trim()) throw new Error('Service description is required.');
      if (serviceQty <= 0) throw new Error('Quantity must be greater than 0.');
      await apiRequest('jobs/add-service-item', {
        jobId: itemsJobId,
        description: serviceDesc,
        quantity: serviceQty,
        unitPrice: servicePrice
      });
      notify('success', 'Service item added.');
      setServiceDesc('');
      setServiceQty(1);
      setServicePrice(0);
      await refreshItems();
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const allocateInventory = async () => {
    if (!itemsJobId) return;
    try {
      if (!allocateInvId) throw new Error('Select an inventory item.');
      if (allocateQty <= 0) throw new Error('Quantity must be greater than 0.');
      await apiRequest('inventory/allocate', {
        jobId: itemsJobId,
        inventoryItemId: allocateInvId,
        quantity: allocateQty
      });
      notify('success', 'Inventory allocated to job.');
      setAllocateInvId(0);
      setAllocateQty(1);
      await refreshItems();
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const removeItem = async (jobItemId: number) => {
    if (!itemsJobId) return;
    try {
      await apiRequest('jobs/remove-item', { jobId: itemsJobId, jobItemId });
      notify('success', 'Job item removed.');
      await refreshItems();
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const exportPdf = async (id: number) => {
    try {
      const res = await apiRequest<{ canceled: boolean; filePath?: string }>('pdf/generate', { type: 'job', id });
      if (!res.canceled) notify('success', `Job sheet PDF saved to ${res.filePath}`);
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const previewPdf = async (id: number) => {
    try {
      const res = await apiRequest<{ dataUrl: string }>('pdf/preview', { type: 'job', id });
      setPreviewDataUrl(res.dataUrl);
      setPreviewOpen(true);
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const printDocument = async (id: number) => {
    try {
      await apiRequest('pdf/print', { type: 'job', id });
      notify('success', 'Print dialog opened for job sheet.');
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const composeCompletionEmail = async (id: number) => {
    try {
      await apiRequest('mail/compose', { template: 'job', id });
      notify('success', 'Opened default mail client with completion email.');
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const runExport = async (format: 'xlsx' | 'csv') => {
    try {
      const res = await exportModule('jobs', format);
      if (!res.canceled) notify('success', `Jobs exported to ${res.filePath}`);
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const goToInvoiceStep = async (row: JobRow) => {
    if (row.status !== 'Completed') {
      notify('error', 'Complete the job first, then generate invoice.');
      return;
    }
    navigate(`/invoices?jobId=${row.id}`);
  };

  const itemsTotal = useMemo(() => sumBy(jobItems, (item) => Number(item.lineTotal || 0)), [jobItems]);

  return (
    <div>
      <PageHeader
        title="Jobs / Work Orders"
        subtitle="Step 2 of 3: run the job and complete it before invoicing"
        actions={
          <>
            <button className="btn-secondary" onClick={() => runExport('xlsx')}>
              Export XLSX
            </button>
            <button className="btn-secondary" onClick={() => runExport('csv')}>
              Export CSV
            </button>
            <button className="btn-primary" onClick={openCreate}>
              New Job
            </button>
          </>
        }
      />
      <WorkflowSteps currentStep={2} />

      {highlightedJobId ? (
        <div className="mb-4 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800">
          Job flow context active. This job was opened from Estimate step.
        </div>
      ) : null}

      <div className="mb-4 card">
        <div className="flex flex-wrap gap-2">
          <input className="input max-w-xs" placeholder="Search job/customer" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="select max-w-xs" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="ALL">All Status</option>
            {statuses.map((s) => (
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
              <th>Job Code</th>
              <th>Customer</th>
              <th>Title</th>
              <th>Status</th>
              <th>Planned</th>
              <th>Amount</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.id} className={row.id === highlightedJobId ? 'bg-brand-50/60' : ''}>
                  <td className="font-medium">{row.jobCode}</td>
                  <td>{row.customerName}</td>
                  <td>{row.title}</td>
                  <td>
                    <select className="select h-8" value={row.status} onChange={(e) => void changeStatus(row.id, e.target.value as JobStatus)}>
                      {statuses.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </td>
                  <td>{formatDate(row.plannedStartDate)} - {formatDate(row.plannedEndDate)}</td>
                  <td>{formatCurrency(Number(row.estimatedAmount || 0) + Number(row.laborCharges || 0) + Number(row.extraCharges || 0) + Number(row.finalAdjustments || 0))}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      <button className="btn-secondary" onClick={() => void openEdit(row)}>Edit</button>
                      <button className="btn-secondary" onClick={() => void openItems(row)}>Items</button>
                      <button className="btn-secondary" onClick={() => void previewPdf(row.id)}>View</button>
                      <button className="btn-secondary" onClick={() => void exportPdf(row.id)}>PDF</button>
                      <button className="btn-secondary" onClick={() => void printDocument(row.id)}>Print</button>
                      <button className="btn-secondary" onClick={() => void composeCompletionEmail(row.id)}>Email</button>
                      {row.status !== 'Completed' && row.status !== 'Cancelled' ? (
                        <button className="btn-secondary" onClick={() => void changeStatus(row.id, 'Completed')}>
                          Mark Completed
                        </button>
                      ) : null}
                      <button
                        className={row.status === 'Completed' ? 'btn-primary' : 'btn-secondary opacity-60'}
                        disabled={row.status !== 'Completed'}
                        onClick={() => void goToInvoiceStep(row)}
                        title={row.status === 'Completed' ? 'Proceed to Step 3 invoice' : 'Complete this job first'}
                      >
                        Step 3: Invoice
                      </button>
                      <button className="btn-danger" onClick={() => setDeleteId(row.id)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="text-center text-slate-500">No jobs found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={openForm} onClose={() => setOpenForm(false)} title={editing ? 'Edit Job' : 'New Job'}>
        <form onSubmit={submitJob} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm">Customer *</label>
              <select className="select" value={jobForm.customerId} onChange={(e) => setJobForm((p) => ({ ...p, customerId: Number(e.target.value) }))}>
                <option value={0}>Select customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm">Linked Estimate</label>
              <select className="select" value={jobForm.estimateId} onChange={(e) => setJobForm((p) => ({ ...p, estimateId: Number(e.target.value) }))}>
                <option value={0}>None</option>
                {estimates.map((est) => (
                  <option key={est.id} value={est.id}>{est.estimateNumber} - {est.customerName}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm">Status</label>
              <select className="select" value={jobForm.status} onChange={(e) => setJobForm((p) => ({ ...p, status: e.target.value as JobStatus }))}>
                {statuses.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm">Job Title *</label>
              <input className="input" value={jobForm.title} onChange={(e) => setJobForm((p) => ({ ...p, title: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm">Job Location</label>
              <input className="input" value={jobForm.location} onChange={(e) => setJobForm((p) => ({ ...p, location: e.target.value }))} />
            </div>
            <div className="md:col-span-3">
              <label className="mb-1 block text-sm">Description</label>
              <textarea className="textarea" rows={2} value={jobForm.description} onChange={(e) => setJobForm((p) => ({ ...p, description: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm">Planned Start</label>
              <input className="input" type="date" value={jobForm.plannedStartDate} onChange={(e) => setJobForm((p) => ({ ...p, plannedStartDate: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm">Planned End</label>
              <input className="input" type="date" value={jobForm.plannedEndDate} onChange={(e) => setJobForm((p) => ({ ...p, plannedEndDate: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm">Actual Completion</label>
              <input className="input" type="date" value={jobForm.actualCompletionDate} onChange={(e) => setJobForm((p) => ({ ...p, actualCompletionDate: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm">Estimated Amount (LKR)</label>
              <input className="input" type="number" min="0" step="0.01" value={jobForm.estimatedAmount} onChange={(e) => setJobForm((p) => ({ ...p, estimatedAmount: Number(e.target.value) }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm">Labor Charges (LKR)</label>
              <input className="input" type="number" min="0" step="0.01" value={jobForm.laborCharges} onChange={(e) => setJobForm((p) => ({ ...p, laborCharges: Number(e.target.value) }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm">Extra Charges (LKR)</label>
              <input className="input" type="number" min="0" step="0.01" value={jobForm.extraCharges} onChange={(e) => setJobForm((p) => ({ ...p, extraCharges: Number(e.target.value) }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm">Final Adjustments (LKR)</label>
              <input className="input" type="number" step="0.01" value={jobForm.finalAdjustments} onChange={(e) => setJobForm((p) => ({ ...p, finalAdjustments: Number(e.target.value) }))} />
            </div>
            <div className="md:col-span-3">
              <label className="mb-1 block text-sm">Assigned Staff</label>
              <div className="grid grid-cols-2 gap-2 rounded-md border border-slate-200 p-2 md:grid-cols-3">
                {staff.map((s) => {
                  const checked = jobForm.staffIds.includes(s.id);
                  return (
                    <label key={s.id} className="inline-flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setJobForm((p) => ({
                            ...p,
                            staffIds: e.target.checked ? [...p.staffIds, s.id] : p.staffIds.filter((id) => id !== s.id)
                          }))
                        }
                      />
                      {s.name}
                    </label>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm">Notes</label>
              <textarea className="textarea" rows={2} value={jobForm.notes} onChange={(e) => setJobForm((p) => ({ ...p, notes: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm">Internal Remarks</label>
              <textarea className="textarea" rows={2} value={jobForm.internalRemarks} onChange={(e) => setJobForm((p) => ({ ...p, internalRemarks: e.target.value }))} />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setOpenForm(false)}>Cancel</button>
            <button className="btn-primary">{editing ? 'Update Job' : 'Create Job'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={itemsJobId !== null} onClose={() => setItemsJobId(null)} title={`Job Items - ${itemsJobCode}`}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 rounded-md border border-slate-200 p-3 md:grid-cols-3">
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm">Allocate inventory item</label>
              <select className="select" value={allocateInvId} onChange={(e) => setAllocateInvId(Number(e.target.value))}>
                <option value={0}>Select inventory item</option>
                {inventory.map((inv) => (
                  <option key={inv.id} value={inv.id}>{inv.name} (Stock: {inv.quantityInStock})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm">Quantity</label>
              <input className="input" type="number" min="1" step="1" value={allocateQty} onChange={(e) => setAllocateQty(Number(e.target.value))} />
            </div>
            <div className="md:col-span-3 flex justify-end">
              <button className="btn-primary" onClick={() => void allocateInventory()}>Allocate To Job</button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 rounded-md border border-slate-200 p-3 md:grid-cols-4">
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm">Service / Labor Description</label>
              <input className="input" value={serviceDesc} onChange={(e) => setServiceDesc(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm">Qty</label>
              <input className="input" type="number" min="1" step="1" value={serviceQty} onChange={(e) => setServiceQty(Number(e.target.value))} />
            </div>
            <div>
              <label className="mb-1 block text-sm">Unit Price</label>
              <input className="input" type="number" min="0" step="0.01" value={servicePrice} onChange={(e) => setServicePrice(Number(e.target.value))} />
            </div>
            <div className="md:col-span-4 flex justify-end">
              <button className="btn-secondary" onClick={() => void addServiceItem()}>Add Service Item</button>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Qty</th>
                  <th>Unit Price</th>
                  <th>Total</th>
                  <th>Source</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobItems.length ? (
                  jobItems.map((item) => (
                    <tr key={item.id}>
                      <td>{item.description}</td>
                      <td>{item.quantity}</td>
                      <td>{formatCurrency(item.unitPrice)}</td>
                      <td>{formatCurrency(item.lineTotal)}</td>
                      <td>{item.allocatedFromStock ? 'Inventory' : 'Service'}</td>
                      <td>
                        <button className="btn-danger" onClick={() => void removeItem(item.id)}>Remove</button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="text-center text-slate-500">No job items yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="text-right text-sm font-semibold">Items Total: {formatCurrency(itemsTotal)}</div>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteId !== null}
        title="Delete Job"
        message="Delete this job and restore allocated stock where relevant?"
        onCancel={() => setDeleteId(null)}
        onConfirm={() => void removeJob()}
        confirmLabel="Delete"
      />

      <PdfPreviewModal
        open={previewOpen}
        title="Job Sheet Preview"
        dataUrl={previewDataUrl}
        onClose={() => {
          setPreviewOpen(false);
          setPreviewDataUrl('');
        }}
      />
    </div>
  );
};
