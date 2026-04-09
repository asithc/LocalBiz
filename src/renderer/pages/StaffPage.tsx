import { FormEvent, useEffect, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { apiRequest, exportModule } from '../lib/api';
import { useUiStore } from '../store/uiStore';
import { formatCurrency } from '../utils/format';

interface StaffRow {
  id: number;
  name: string;
  roleTitle?: string;
  phone?: string;
  email?: string;
  monthlySalary: number;
  isActive: number;
  notes?: string;
}

interface SalaryRecord {
  id: number;
  staffId: number;
  staffName: string;
  month: string;
  amount: number;
  isPaid: number;
  notes?: string;
}

const emptyStaff: Partial<StaffRow> = {
  name: '',
  roleTitle: '',
  phone: '',
  email: '',
  monthlySalary: 0,
  isActive: 1,
  notes: ''
};

export const StaffPage = () => {
  const notify = useUiStore((s) => s.notify);

  const [rows, setRows] = useState<StaffRow[]>([]);
  const [salaries, setSalaries] = useState<SalaryRecord[]>([]);
  const [search, setSearch] = useState('');

  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState<StaffRow | null>(null);
  const [form, setForm] = useState<Partial<StaffRow>>(emptyStaff);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const [salaryStaffId, setSalaryStaffId] = useState<number>(0);
  const [salaryMonth, setSalaryMonth] = useState(new Date().toISOString().slice(0, 7));
  const [salaryAmount, setSalaryAmount] = useState<number>(0);
  const [salaryNotes, setSalaryNotes] = useState('');

  const [staffJobs, setStaffJobs] = useState<any[]>([]);
  const [openStaffJobs, setOpenStaffJobs] = useState(false);
  const [staffJobsTitle, setStaffJobsTitle] = useState('');

  const load = async () => {
    const [staffData, salaryData] = await Promise.all([
      apiRequest<StaffRow[]>('staff/list', { search }),
      apiRequest<SalaryRecord[]>('staff/salaries')
    ]);
    setRows(staffData);
    setSalaries(salaryData);
  };

  useEffect(() => {
    void load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyStaff);
    setOpenForm(true);
  };

  const openEdit = (row: StaffRow) => {
    setEditing(row);
    setForm(row);
    setOpenForm(true);
  };

  const saveStaff = async (e: FormEvent) => {
    e.preventDefault();
    try {
      if (!form.name?.trim()) throw new Error('Staff name is required.');
      if (Number(form.monthlySalary || 0) < 0) throw new Error('Salary cannot be negative.');

      if (editing) {
        await apiRequest('staff/update', { id: editing.id, data: form });
        notify('success', 'Staff updated.');
      } else {
        await apiRequest('staff/create', form);
        notify('success', 'Staff created.');
      }

      setOpenForm(false);
      await load();
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const removeStaff = async () => {
    if (!deleteId) return;
    try {
      await apiRequest('staff/delete', { id: deleteId });
      notify('success', 'Staff deleted.');
      setDeleteId(null);
      await load();
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const addSalary = async (e: FormEvent) => {
    e.preventDefault();
    try {
      if (!salaryStaffId) throw new Error('Select staff member.');
      if (!salaryMonth.trim()) throw new Error('Salary month is required.');
      if (salaryAmount < 0) throw new Error('Salary amount cannot be negative.');

      await apiRequest('staff/salary/create', {
        staffId: salaryStaffId,
        month: salaryMonth,
        amount: salaryAmount,
        notes: salaryNotes
      });
      notify('success', 'Salary record added.');
      setSalaryStaffId(0);
      setSalaryAmount(0);
      setSalaryNotes('');
      await load();
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const toggleSalaryStatus = async (record: SalaryRecord) => {
    try {
      await apiRequest('staff/salary/status', { id: record.id, isPaid: record.isPaid ? 0 : 1 });
      notify('success', 'Salary status updated.');
      await load();
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const viewJobsByStaff = async (row: StaffRow) => {
    try {
      const jobs = await apiRequest<any[]>('staff/jobs', { staffId: row.id });
      setStaffJobs(jobs);
      setStaffJobsTitle(row.name);
      setOpenStaffJobs(true);
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const runExport = async (format: 'xlsx' | 'csv') => {
    try {
      const res = await exportModule('staff', format);
      if (!res.canceled) notify('success', `Staff exported to ${res.filePath}`);
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  return (
    <div>
      <PageHeader
        title="Staff & Salary"
        subtitle="Manage workforce and simple salary tracking"
        actions={
          <>
            <button className="btn-secondary" onClick={() => runExport('xlsx')}>Export XLSX</button>
            <button className="btn-secondary" onClick={() => runExport('csv')}>Export CSV</button>
            <button className="btn-primary" onClick={openCreate}>Add Staff</button>
          </>
        }
      />

      <div className="mb-4 card">
        <div className="flex gap-2">
          <input className="input max-w-md" placeholder="Search staff" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className="btn-secondary" onClick={load}>Search</button>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Phone</th>
              <th>Email</th>
              <th>Monthly Salary</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.id}>
                  <td className="font-medium">{row.name}</td>
                  <td>{row.roleTitle || '-'}</td>
                  <td>{row.phone || '-'}</td>
                  <td>{row.email || '-'}</td>
                  <td>{formatCurrency(row.monthlySalary)}</td>
                  <td>{row.isActive ? 'Active' : 'Inactive'}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      <button className="btn-secondary" onClick={() => openEdit(row)}>Edit</button>
                      <button className="btn-secondary" onClick={() => void viewJobsByStaff(row)}>View Jobs</button>
                      <button className="btn-danger" onClick={() => setDeleteId(row.id)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="text-center text-slate-500">No staff records found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-1">
          <h3 className="mb-3 text-base font-semibold">Add Salary Record</h3>
          <form className="space-y-3" onSubmit={addSalary}>
            <div>
              <label className="mb-1 block text-sm">Staff</label>
              <select className="select" value={salaryStaffId} onChange={(e) => setSalaryStaffId(Number(e.target.value))}>
                <option value={0}>Select staff</option>
                {rows.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm">Month (YYYY-MM)</label>
              <input className="input" value={salaryMonth} onChange={(e) => setSalaryMonth(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm">Amount (LKR)</label>
              <input className="input" type="number" min="0" step="0.01" value={salaryAmount} onChange={(e) => setSalaryAmount(Number(e.target.value))} />
            </div>
            <div>
              <label className="mb-1 block text-sm">Notes</label>
              <textarea className="textarea" rows={2} value={salaryNotes} onChange={(e) => setSalaryNotes(e.target.value)} />
            </div>
            <button className="btn-primary w-full">Save Salary Record</button>
          </form>
        </div>

        <div className="card lg:col-span-2">
          <h3 className="mb-3 text-base font-semibold">Salary Records</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Month</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Notes</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {salaries.length ? (
                  salaries.map((record) => (
                    <tr key={record.id}>
                      <td>{record.staffName}</td>
                      <td>{record.month}</td>
                      <td>{formatCurrency(record.amount)}</td>
                      <td>{record.isPaid ? 'Paid' : 'Pending'}</td>
                      <td>{record.notes || '-'}</td>
                      <td>
                        <button className="btn-secondary" onClick={() => void toggleSalaryStatus(record)}>
                          Mark {record.isPaid ? 'Unpaid' : 'Paid'}
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="text-center text-slate-500">No salary records yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Modal open={openForm} onClose={() => setOpenForm(false)} title={editing ? 'Edit Staff' : 'Add Staff'} width="max-w-2xl">
        <form className="grid grid-cols-1 gap-3 md:grid-cols-2" onSubmit={saveStaff}>
          <div>
            <label className="mb-1 block text-sm">Name *</label>
            <input className="input" value={form.name || ''} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
          </div>
          <div>
            <label className="mb-1 block text-sm">Role / Title</label>
            <input className="input" value={form.roleTitle || ''} onChange={(e) => setForm((p) => ({ ...p, roleTitle: e.target.value }))} />
          </div>
          <div>
            <label className="mb-1 block text-sm">Phone</label>
            <input className="input" value={form.phone || ''} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
          </div>
          <div>
            <label className="mb-1 block text-sm">Email</label>
            <input className="input" type="email" value={form.email || ''} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
          </div>
          <div>
            <label className="mb-1 block text-sm">Monthly Salary (LKR)</label>
            <input className="input" type="number" min="0" step="0.01" value={form.monthlySalary || 0} onChange={(e) => setForm((p) => ({ ...p, monthlySalary: Number(e.target.value) }))} />
          </div>
          <div>
            <label className="mb-1 block text-sm">Status</label>
            <select className="select" value={form.isActive || 0} onChange={(e) => setForm((p) => ({ ...p, isActive: Number(e.target.value) }))}>
              <option value={1}>Active</option>
              <option value={0}>Inactive</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm">Notes</label>
            <textarea className="textarea" rows={3} value={form.notes || ''} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
          </div>
          <div className="md:col-span-2 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setOpenForm(false)}>Cancel</button>
            <button className="btn-primary">{editing ? 'Update' : 'Create'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={openStaffJobs} onClose={() => setOpenStaffJobs(false)} title={`Jobs for ${staffJobsTitle}`} width="max-w-2xl">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Job Code</th>
                <th>Title</th>
                <th>Status</th>
                <th>Customer</th>
              </tr>
            </thead>
            <tbody>
              {staffJobs.length ? (
                staffJobs.map((job) => (
                  <tr key={job.id}>
                    <td>{job.jobCode}</td>
                    <td>{job.title}</td>
                    <td>{job.status}</td>
                    <td>{job.customerName}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="text-center text-slate-500">No assigned jobs found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteId !== null}
        title="Delete Staff"
        message="Delete this staff member?"
        onCancel={() => setDeleteId(null)}
        onConfirm={() => void removeStaff()}
        confirmLabel="Delete"
      />
    </div>
  );
};
