import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { Customer } from '@shared/types';
import { apiRequest, exportModule } from '../lib/api';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useUiStore } from '../store/uiStore';
import { formatCurrency, formatDate } from '../utils/format';

const empty: Partial<Customer> = {
  name: '',
  phone: '',
  email: '',
  address: '',
  notes: ''
};

interface CustomerRow extends Customer {
  estimateCount?: number;
  invoiceCount?: number;
  ongoingJobCount?: number;
  totalInvoiced?: number;
  totalReceived?: number;
}

interface CustomerInsights {
  customer: Customer;
  summary: {
    estimateCount: number;
    invoiceCount: number;
    totalInvoiced: number;
    totalReceived: number;
    ongoingJobCount: number;
    completedJobCount: number;
    ongoingStaffCount: number;
  };
  ongoingJobs: Array<{
    id: number;
    jobCode: string;
    title: string;
    status: string;
    location?: string;
    plannedStartDate?: string;
    plannedEndDate?: string;
    actualCompletionDate?: string;
    staffNames?: string;
    staffCount?: number;
  }>;
  recentEstimates: Array<{
    id: number;
    estimateNumber: string;
    issueDate: string;
    status: string;
    grandTotal: number;
  }>;
  recentInvoices: Array<{
    id: number;
    invoiceNumber: string;
    issueDate: string;
    paymentStatus: string;
    total: number;
  }>;
  timeline: Array<{
    eventDate: string;
    eventType: string;
    reference: string;
    description: string;
  }>;
}

export const CustomersPage = () => {
  const notify = useUiStore((s) => s.notify);

  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [search, setSearch] = useState('');
  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState<Partial<Customer>>(empty);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [insightCustomer, setInsightCustomer] = useState<CustomerRow | null>(null);
  const [insights, setInsights] = useState<CustomerInsights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);

  const load = async () => {
    const data = await apiRequest<CustomerRow[]>('customers/list', { search });
    setRows(data);
  };

  useEffect(() => {
    void load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(empty);
    setOpenForm(true);
  };

  const openEdit = (row: Customer) => {
    setEditing(row);
    setForm(row);
    setOpenForm(true);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      if (!form.name?.trim()) throw new Error('Customer name is required.');
      if (!form.phone?.trim()) throw new Error('Phone number is required.');

      if (editing) {
        await apiRequest('customers/update', { id: editing.id, data: form });
        notify('success', 'Customer updated.');
      } else {
        await apiRequest('customers/create', form);
        notify('success', 'Customer created.');
      }
      setOpenForm(false);
      await load();
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const remove = async () => {
    if (!deletingId) return;
    try {
      await apiRequest('customers/delete', { id: deletingId });
      notify('success', 'Customer deleted.');
      setDeletingId(null);
      await load();
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const runExport = async (format: 'xlsx' | 'csv') => {
    try {
      const res = await exportModule('customers', format);
      if (!res.canceled) notify('success', `Customers exported to ${res.filePath}`);
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const openInsights = async (row: CustomerRow) => {
    try {
      setInsightCustomer(row);
      setInsightsLoading(true);
      const data = await apiRequest<CustomerInsights>('customers/insights', { customerId: row.id });
      setInsights(data);
    } catch (error) {
      setInsightCustomer(null);
      notify('error', (error as Error).message);
    } finally {
      setInsightsLoading(false);
    }
  };

  const closeInsights = () => {
    setInsightCustomer(null);
    setInsights(null);
    setInsightsLoading(false);
  };

  const totals = useMemo(
    () => ({
      customers: rows.length,
      estimates: rows.reduce((sum, r) => sum + Number(r.estimateCount || 0), 0),
      invoices: rows.reduce((sum, r) => sum + Number(r.invoiceCount || 0), 0),
      received: rows.reduce((sum, r) => sum + Number(r.totalReceived || 0), 0)
    }),
    [rows]
  );

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle="Manage customer records and track customer value"
        actions={
          <>
            <button className="btn-secondary" onClick={() => runExport('xlsx')}>
              Export XLSX
            </button>
            <button className="btn-secondary" onClick={() => runExport('csv')}>
              Export CSV
            </button>
            <button className="btn-primary" onClick={openCreate}>
              Add Customer
            </button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="card">
          <div className="text-xs uppercase tracking-wide text-slate-500">Customers</div>
          <div className="mt-1 text-xl font-semibold text-slate-900">{totals.customers}</div>
        </div>
        <div className="card">
          <div className="text-xs uppercase tracking-wide text-slate-500">Total Estimates</div>
          <div className="mt-1 text-xl font-semibold text-slate-900">{totals.estimates}</div>
        </div>
        <div className="card">
          <div className="text-xs uppercase tracking-wide text-slate-500">Total Invoices</div>
          <div className="mt-1 text-xl font-semibold text-slate-900">{totals.invoices}</div>
        </div>
        <div className="card">
          <div className="text-xs uppercase tracking-wide text-slate-500">Total Received</div>
          <div className="mt-1 text-xl font-semibold text-emerald-700">{formatCurrency(totals.received)}</div>
        </div>
      </div>

      <div className="mb-4 card">
        <div className="flex gap-2">
          <input
            className="input max-w-md"
            placeholder="Search customers"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn-secondary" onClick={load}>
            Search
          </button>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Email</th>
              <th>Ongoing Jobs</th>
              <th>Estimates</th>
              <th>Invoices</th>
              <th>Revenue</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.id}>
                  <td className="font-medium">{row.name}</td>
                  <td>{row.phone}</td>
                  <td>{row.email || '-'}</td>
                  <td>{row.ongoingJobCount || 0}</td>
                  <td>{row.estimateCount || 0}</td>
                  <td>{row.invoiceCount || 0}</td>
                  <td>{formatCurrency(row.totalReceived || 0)}</td>
                  <td>
                    <div className="flex gap-1">
                      <button className="btn-secondary" onClick={() => void openInsights(row)}>
                        Insights
                      </button>
                      <button className="btn-secondary" onClick={() => openEdit(row)}>
                        Edit
                      </button>
                      <button className="btn-danger" onClick={() => setDeletingId(row.id)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="text-center text-slate-500">
                  No customers found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={openForm} onClose={() => setOpenForm(false)} title={editing ? 'Edit Customer' : 'Add Customer'} width="max-w-2xl">
        <form className="grid grid-cols-1 gap-3 md:grid-cols-2" onSubmit={submit}>
          <div>
            <label className="mb-1 block text-sm">Customer Name *</label>
            <input className="input" value={form.name || ''} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
          </div>
          <div>
            <label className="mb-1 block text-sm">Phone *</label>
            <input className="input" value={form.phone || ''} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
          </div>
          <div>
            <label className="mb-1 block text-sm">Email</label>
            <input className="input" type="email" value={form.email || ''} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
          </div>
          <div>
            <label className="mb-1 block text-sm">Address</label>
            <input className="input" value={form.address || ''} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm">Notes</label>
            <textarea className="textarea" rows={3} value={form.notes || ''} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
          </div>
          <div className="md:col-span-2 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setOpenForm(false)}>
              Cancel
            </button>
            <button className="btn-primary">{editing ? 'Update' : 'Create'}</button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={deletingId !== null}
        title="Delete Customer"
        message="Are you sure you want to delete this customer?"
        onCancel={() => setDeletingId(null)}
        onConfirm={remove}
        confirmLabel="Delete"
      />

      <Modal
        open={insightCustomer !== null}
        onClose={closeInsights}
        title={`Customer Insights${insightCustomer ? ` - ${insightCustomer.name}` : ''}`}
        width="max-w-5xl"
      >
        {insightsLoading ? (
          <div className="py-8 text-center text-slate-500">Loading customer activity...</div>
        ) : !insights ? (
          <div className="py-8 text-center text-slate-500">No data available.</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs uppercase tracking-wide text-slate-500">Ongoing Jobs</div>
                <div className="text-lg font-semibold text-slate-900">{insights.summary.ongoingJobCount}</div>
                <div className="text-xs text-slate-500">People assigned: {insights.summary.ongoingStaffCount}</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs uppercase tracking-wide text-slate-500">Completed Jobs</div>
                <div className="text-lg font-semibold text-slate-900">{insights.summary.completedJobCount}</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs uppercase tracking-wide text-slate-500">Estimates / Invoices</div>
                <div className="text-lg font-semibold text-slate-900">
                  {insights.summary.estimateCount} / {insights.summary.invoiceCount}
                </div>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <div className="text-xs uppercase tracking-wide text-emerald-700">Money Made</div>
                <div className="text-lg font-semibold text-emerald-800">{formatCurrency(insights.summary.totalReceived)}</div>
                <div className="text-xs text-emerald-700">Invoiced: {formatCurrency(insights.summary.totalInvoiced)}</div>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <h3 className="mb-2 text-sm font-semibold text-slate-900">Current Ongoing Jobs & Involved People</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Job Code</th>
                      <th>Title</th>
                      <th>Status</th>
                      <th>Planned Dates</th>
                      <th>Involved People</th>
                    </tr>
                  </thead>
                  <tbody>
                    {insights.ongoingJobs.length ? (
                      insights.ongoingJobs.map((job) => (
                        <tr key={job.id}>
                          <td className="font-medium">{job.jobCode}</td>
                          <td>{job.title}</td>
                          <td>{job.status}</td>
                          <td>
                            {formatDate(job.plannedStartDate)} - {formatDate(job.plannedEndDate)}
                          </td>
                          <td>{job.staffNames || '-'}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="text-center text-slate-500">
                          No ongoing jobs for this customer.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <h3 className="mb-2 text-sm font-semibold text-slate-900">Recent Estimates</h3>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Estimate #</th>
                        <th>Date</th>
                        <th>Status</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {insights.recentEstimates.length ? (
                        insights.recentEstimates.map((row) => (
                          <tr key={row.id}>
                            <td className="font-medium">{row.estimateNumber}</td>
                            <td>{formatDate(row.issueDate)}</td>
                            <td>{row.status}</td>
                            <td>{formatCurrency(row.grandTotal)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={4} className="text-center text-slate-500">
                            No estimates yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <h3 className="mb-2 text-sm font-semibold text-slate-900">Recent Invoices</h3>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Invoice #</th>
                        <th>Date</th>
                        <th>Payment</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {insights.recentInvoices.length ? (
                        insights.recentInvoices.map((row) => (
                          <tr key={row.id}>
                            <td className="font-medium">{row.invoiceNumber}</td>
                            <td>{formatDate(row.issueDate)}</td>
                            <td>{row.paymentStatus}</td>
                            <td>{formatCurrency(row.total)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={4} className="text-center text-slate-500">
                            No invoices yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <h3 className="mb-2 text-sm font-semibold text-slate-900">Job History Timeline</h3>
              <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {insights.timeline.length ? (
                  insights.timeline.map((item, idx) => (
                    <div key={`${item.eventType}-${item.reference}-${idx}`} className="rounded-md border border-slate-200 bg-slate-50 p-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs font-semibold uppercase tracking-wide text-brand-700">{item.eventType}</div>
                        <div className="text-xs text-slate-500">{new Date(item.eventDate).toLocaleString()}</div>
                      </div>
                      <div className="mt-1 text-sm font-medium text-slate-800">{item.reference || '-'}</div>
                      <div className="text-sm text-slate-600">{item.description}</div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-3 text-center text-sm text-slate-500">
                    No timeline activity for this customer yet.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
