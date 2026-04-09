import { FormEvent, useEffect, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { apiRequest } from '../lib/api';
import { useUiStore } from '../store/uiStore';
import { useAuthStore } from '../store/authStore';

interface SettingsForm {
  business_name: string;
  business_address: string;
  business_phone: string;
  business_email: string;
  business_logo: string;
  default_currency: string;
  invoice_notes: string;
  estimate_notes: string;
  brand_primary: string;
  brand_secondary: string;
  sub_brand_name: string;
  sub_brand_logo: string;
  gdrive_client_id: string;
  gdrive_client_secret: string;
  gdrive_account_email: string;
  gdrive_connected_email: string;
  gdrive_folder_id: string;
  gdrive_refresh_token: string;
  gdrive_last_backup_at: string;
  gdrive_stocks_file_id: string;
  gdrive_stocks_published_at: string;
  gdrive_stocks_auto_publish: string;
  smtp_host: string;
  smtp_port: string;
  smtp_username: string;
  smtp_password: string;
}

const defaults: SettingsForm = {
  business_name: '',
  business_address: '',
  business_phone: '',
  business_email: '',
  business_logo: '',
  default_currency: 'LKR',
  invoice_notes: '',
  estimate_notes: '',
  brand_primary: '#FB1E2C',
  brand_secondary: '#00A7E6',
  sub_brand_name: 'Wiring Malli',
  sub_brand_logo: '',
  gdrive_client_id: '',
  gdrive_client_secret: '',
  gdrive_account_email: 'jayakulabrothers@gmai.com',
  gdrive_connected_email: '',
  gdrive_folder_id: '',
  gdrive_refresh_token: '',
  gdrive_last_backup_at: '',
  gdrive_stocks_file_id: '',
  gdrive_stocks_published_at: '',
  gdrive_stocks_auto_publish: '0',
  smtp_host: '',
  smtp_port: '',
  smtp_username: '',
  smtp_password: ''
};

export const SettingsPage = () => {
  const notify = useUiStore((s) => s.notify);
  const session = useAuthStore((s) => s.session);
  const isAdmin = session?.role === 'Admin';

  const [form, setForm] = useState<SettingsForm>(defaults);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [driveAuth, setDriveAuth] = useState<{
    deviceCode: string;
    userCode: string;
    verificationUrl: string;
    expiresIn: number;
    interval: number;
  } | null>(null);
  const [driveBusy, setDriveBusy] = useState(false);

  const load = async () => {
    const data = await apiRequest<Record<string, string>>('settings/get');
    setForm({ ...defaults, ...data });
  };

  useEffect(() => {
    void load();
  }, []);

  const saveSettings = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('settings/update', { data: form });
      notify('success', 'Settings updated.');
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const selectLogo = async () => {
    try {
      const selected = await apiRequest<{ canceled: boolean; filePath?: string }>('settings/select-logo');
      if (selected.canceled || !selected.filePath) return;

      const saved = await apiRequest<{ path: string }>('settings/save-logo', { filePath: selected.filePath });
      setForm((p) => ({ ...p, business_logo: saved.path }));
      notify('success', 'Logo selected. Click Save Settings to persist it.');
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const selectSubBrandLogo = async () => {
    try {
      const selected = await apiRequest<{ canceled: boolean; filePath?: string }>('settings/select-logo');
      if (selected.canceled || !selected.filePath) return;

      const saved = await apiRequest<{ path: string }>('settings/save-logo', { filePath: selected.filePath });
      setForm((p) => ({ ...p, sub_brand_logo: saved.path }));
      notify('success', 'Sub-brand logo selected. Click Save Settings to persist it.');
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const startGoogleConnect = async () => {
    try {
      if (!isAdmin) return;
      if (!form.gdrive_client_id.trim()) {
        throw new Error('Please paste your Google Client ID first.');
      }
      setDriveBusy(true);
      // Persist current form (esp. Client ID/Secret/Folder) before talking to Google,
      // so users don't have to remember to click "Save Settings" first.
      await apiRequest('settings/update', { data: form });
      const data = await apiRequest<{
        deviceCode: string;
        userCode: string;
        verificationUrl: string;
        expiresIn: number;
        interval: number;
      }>('gdrive/device/start');
      setDriveAuth(data);
      notify('info', 'Google device code generated. Complete verification in browser.');
    } catch (error) {
      notify('error', (error as Error).message);
    } finally {
      setDriveBusy(false);
    }
  };

  const completeGoogleConnect = async () => {
    try {
      if (!driveAuth) {
        throw new Error('Start Google connection first.');
      }
      setDriveBusy(true);
      await apiRequest('gdrive/device/finish', {
        deviceCode: driveAuth.deviceCode,
        interval: driveAuth.interval,
        timeoutSeconds: driveAuth.expiresIn
      });
      notify('success', 'Google Drive connected and account verified.');
      setDriveAuth(null);
      await load();
    } catch (error) {
      notify('error', (error as Error).message);
    } finally {
      setDriveBusy(false);
    }
  };

  const uploadGoogleBackup = async () => {
    try {
      setDriveBusy(true);
      const data = await apiRequest<{ fileName: string; backedUpAt: string; accountEmail?: string }>('gdrive/backup/upload');
      notify('success', `Backup uploaded to Google Drive (${data.accountEmail || 'account'}): ${data.fileName}`);
      await load();
    } catch (error) {
      notify('error', (error as Error).message);
    } finally {
      setDriveBusy(false);
    }
  };

  const publishStocksToWeb = async () => {
    try {
      setDriveBusy(true);
      const data = await apiRequest<{
        fileId: string;
        publishedAt: string;
        itemCount: number;
        lowStockCount: number;
        outOfStockCount: number;
      }>('gdrive/stocks/publish');
      notify(
        'success',
        `Published ${data.itemCount} items to Drive (low: ${data.lowStockCount}, out: ${data.outOfStockCount}). File ID: ${data.fileId}`
      );
      await load();
    } catch (error) {
      notify('error', (error as Error).message);
    } finally {
      setDriveBusy(false);
    }
  };

  const unpublishStocksFromWeb = async () => {
    try {
      setDriveBusy(true);
      await apiRequest('gdrive/stocks/unpublish');
      notify('success', 'Stocks unpublished from web. The viewer will stop receiving updates.');
      await load();
    } catch (error) {
      notify('error', (error as Error).message);
    } finally {
      setDriveBusy(false);
    }
  };

  const toggleAutoPublish = async (next: boolean) => {
    try {
      const updated = { ...form, gdrive_stocks_auto_publish: next ? '1' : '0' };
      setForm(updated);
      await apiRequest('settings/update', { data: updated });
      notify('success', next ? 'Auto-publish enabled.' : 'Auto-publish disabled.');
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify('success', `${label} copied to clipboard.`);
    } catch {
      notify('error', `Could not copy ${label}.`);
    }
  };

  const disconnectGoogle = async () => {
    try {
      setDriveBusy(true);
      await apiRequest('gdrive/disconnect');
      notify('success', 'Google Drive disconnected.');
      await load();
    } catch (error) {
      notify('error', (error as Error).message);
    } finally {
      setDriveBusy(false);
    }
  };

  const backupDatabase = async () => {
    try {
      const res = await apiRequest<{ canceled: boolean; path?: string }>('backup/create');
      if (!res.canceled) notify('success', `Backup created: ${res.path}`);
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const restoreDatabase = async () => {
    try {
      const res = await apiRequest<{ canceled: boolean; restoredFrom?: string }>('backup/restore');
      if (!res.canceled) {
        notify('success', `Database restored from ${res.restoredFrom}. Reloading...`);
        window.location.reload();
      }
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    try {
      if (!session) return;
      if (!newPassword || newPassword.length < 8) {
        throw new Error('New password must be 8+ characters and include upper, lower, and number.');
      }
      await apiRequest('auth/change-password', {
        userId: session.userId,
        currentPassword,
        newPassword
      });
      setCurrentPassword('');
      setNewPassword('');
      notify('success', 'Password changed successfully.');
    } catch (error) {
      notify('error', (error as Error).message);
    }
  };

  return (
    <div>
      <PageHeader title="Settings" subtitle="Business profile, backup/restore and configuration" />

      <form className="grid grid-cols-1 gap-4 lg:grid-cols-3" onSubmit={saveSettings}>
        <div className="card lg:col-span-2">
          <h2 className="mb-3 text-base font-semibold">Business Information</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm">Business Name</label>
              <input className="input" value={form.business_name} onChange={(e) => setForm((p) => ({ ...p, business_name: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm">Phone</label>
              <input className="input" value={form.business_phone} onChange={(e) => setForm((p) => ({ ...p, business_phone: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm">Email</label>
              <input className="input" type="email" value={form.business_email} onChange={(e) => setForm((p) => ({ ...p, business_email: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm">Currency</label>
              <input className="input" value={form.default_currency || 'LKR'} disabled />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm">Address</label>
              <textarea className="textarea" rows={2} value={form.business_address} onChange={(e) => setForm((p) => ({ ...p, business_address: e.target.value }))} />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm">Business Logo</label>
              <div className="flex items-center gap-2">
                <input className="input" value={form.business_logo} readOnly />
                <button type="button" className="btn-secondary" onClick={() => void selectLogo()} disabled={!isAdmin}>
                  Choose
                </button>
              </div>
              {form.business_logo ? (
                <img
                  src={form.business_logo}
                  alt="Business logo preview"
                  className="mt-2 h-16 w-auto rounded border border-slate-200 bg-white p-2"
                />
              ) : null}
            </div>
            <div>
              <label className="mb-1 block text-sm">Primary Brand Color</label>
              <input className="input" value={form.brand_primary} onChange={(e) => setForm((p) => ({ ...p, brand_primary: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm">Secondary Brand Color</label>
              <input className="input" value={form.brand_secondary} onChange={(e) => setForm((p) => ({ ...p, brand_secondary: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm">Sub-brand Name</label>
              <input className="input" value={form.sub_brand_name} onChange={(e) => setForm((p) => ({ ...p, sub_brand_name: e.target.value }))} />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm">Sub-brand Logo (Wiring Malli)</label>
              <div className="flex items-center gap-2">
                <input className="input" value={form.sub_brand_logo} readOnly />
                <button type="button" className="btn-secondary" onClick={() => void selectSubBrandLogo()} disabled={!isAdmin}>
                  Choose
                </button>
              </div>
              {form.sub_brand_logo ? (
                <img
                  src={form.sub_brand_logo}
                  alt="Sub-brand logo preview"
                  className="mt-2 h-16 w-auto rounded border border-slate-200 bg-white p-2"
                />
              ) : null}
            </div>
            <div>
              <label className="mb-1 block text-sm">Default Invoice Notes</label>
              <textarea className="textarea" rows={3} value={form.invoice_notes} onChange={(e) => setForm((p) => ({ ...p, invoice_notes: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm">Default Estimate Notes</label>
              <textarea className="textarea" rows={3} value={form.estimate_notes} onChange={(e) => setForm((p) => ({ ...p, estimate_notes: e.target.value }))} />
            </div>
          </div>
        </div>

        <div className="card">
          <h2 className="mb-3 text-base font-semibold">SMTP (Optional)</h2>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm">Host</label>
              <input className="input" value={form.smtp_host} onChange={(e) => setForm((p) => ({ ...p, smtp_host: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm">Port</label>
              <input className="input" value={form.smtp_port} onChange={(e) => setForm((p) => ({ ...p, smtp_port: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm">Username</label>
              <input className="input" value={form.smtp_username} onChange={(e) => setForm((p) => ({ ...p, smtp_username: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-sm">Password</label>
              <input type="password" className="input" value={form.smtp_password} onChange={(e) => setForm((p) => ({ ...p, smtp_password: e.target.value }))} />
            </div>
          </div>
        </div>

        <div className="card lg:col-span-3 flex flex-wrap justify-end gap-2">
          <button className="btn-primary" type="submit" disabled={!isAdmin}>
            Save Settings
          </button>
        </div>
      </form>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-3 text-base font-semibold">Backup & Restore</h2>
          <p className="mb-3 text-sm text-slate-500">Create a backup of the local SQLite database or restore from an existing backup file.</p>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => void backupDatabase()} disabled={!isAdmin}>Backup Database</button>
            <button className="btn-danger" onClick={() => void restoreDatabase()} disabled={!isAdmin}>Restore Database</button>
          </div>
        </div>

        <div className="card">
          <h2 className="mb-3 text-base font-semibold">Change Password</h2>
          <form className="space-y-3" onSubmit={changePassword}>
            <div>
              <label className="mb-1 block text-sm">Current Password</label>
              <input type="password" className="input" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm">New Password</label>
              <input type="password" className="input" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </div>
            <button className="btn-primary">Update Password</button>
          </form>
        </div>
      </div>

      <div className="mt-5 card">
        <h2 className="mb-3 text-base font-semibold">Google Drive Backup Integration</h2>
        <p className="mb-3 text-sm text-slate-500">
          Configure Google OAuth credentials, connect your Drive account, and upload local database backups directly.
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm">Google Client ID</label>
            <input
              className="input"
              value={form.gdrive_client_id}
              onChange={(e) => setForm((p) => ({ ...p, gdrive_client_id: e.target.value }))}
              disabled={!isAdmin}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm">Google Client Secret (optional)</label>
            <input
              className="input"
              type="password"
              value={form.gdrive_client_secret}
              onChange={(e) => setForm((p) => ({ ...p, gdrive_client_secret: e.target.value }))}
              disabled={!isAdmin}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm">Backup Google Account Email</label>
            <input
              className="input"
              type="email"
              value={form.gdrive_account_email}
              onChange={(e) => setForm((p) => ({ ...p, gdrive_account_email: e.target.value.trim() }))}
              disabled={!isAdmin}
              placeholder="example@gmail.com"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm">Drive Folder ID (optional)</label>
            <input
              className="input"
              value={form.gdrive_folder_id}
              onChange={(e) => setForm((p) => ({ ...p, gdrive_folder_id: e.target.value }))}
              disabled={!isAdmin}
            />
          </div>
        </div>

        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
          <div>Connected: {form.gdrive_refresh_token ? 'Yes' : 'No'}</div>
          <div>Required account: {form.gdrive_account_email || '-'}</div>
          <div>Connected account: {form.gdrive_connected_email || '-'}</div>
          <div>Last Drive backup: {form.gdrive_last_backup_at || '-'}</div>
          {driveAuth ? (
            <div className="mt-2 rounded border border-brand-200 bg-white p-2">
              <div className="font-semibold text-brand-700">Google verification required</div>
              <div>User Code: <span className="font-mono font-bold">{driveAuth.userCode}</span></div>
              <div>
                Verification URL:{' '}
                <a className="text-brand-700 underline" href={driveAuth.verificationUrl} target="_blank" rel="noreferrer">
                  {driveAuth.verificationUrl}
                </a>
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={() => void startGoogleConnect()} disabled={!isAdmin || driveBusy}>
            Connect Google Drive
          </button>
          <button className="btn-secondary" onClick={() => void completeGoogleConnect()} disabled={!isAdmin || driveBusy}>
            Complete Connection
          </button>
          <button className="btn-primary" onClick={() => void uploadGoogleBackup()} disabled={!isAdmin || driveBusy || !form.gdrive_refresh_token}>
            Backup To Google Drive
          </button>
          <button className="btn-danger" onClick={() => void disconnectGoogle()} disabled={!isAdmin || driveBusy || !form.gdrive_refresh_token}>
            Disconnect Drive
          </button>
        </div>
      </div>

      <div className="mt-5 card">
        <h2 className="mb-1 text-base font-semibold">Publish Stocks to Web Viewer</h2>
        <p className="mb-3 text-sm text-slate-500">
          Publishes a public-safe stocks snapshot (item name, qty, price, low-stock flag) to your Google Drive
          as a publicly-readable JSON file. The GitHub Pages viewer fetches this file via the Drive API so anyone
          with the viewer link can see the latest stock from anywhere. Cost prices, suppliers and customer data
          are <strong>not</strong> included.
        </p>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
            <div>
              Status:{' '}
              <span className={form.gdrive_stocks_file_id ? 'font-medium text-emerald-700' : 'text-slate-500'}>
                {form.gdrive_stocks_file_id ? 'Published' : 'Not published'}
              </span>
            </div>
            <div>Last published: {form.gdrive_stocks_published_at || '-'}</div>
            <div className="mt-2">
              <label className="mb-1 block text-xs">Drive File ID (paste this into the web viewer config)</label>
              <div className="flex items-center gap-2">
                <input className="input flex-1 font-mono text-xs" readOnly value={form.gdrive_stocks_file_id} />
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={!form.gdrive_stocks_file_id}
                  onClick={() => void copyToClipboard(form.gdrive_stocks_file_id, 'File ID')}
                >
                  Copy
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={form.gdrive_stocks_auto_publish === '1'}
                onChange={(e) => void toggleAutoPublish(e.target.checked)}
                disabled={!isAdmin || !form.gdrive_refresh_token}
              />
              <span>
                <span className="font-medium text-slate-700">Auto-publish on inventory changes</span>
                <span className="block text-xs text-slate-500">
                  Re-uploads the stocks file to Drive ~8 seconds after any inventory create / update / delete /
                  stock adjust / job allocation. Web viewers polling every 30s will see updates within ~40s.
                </span>
              </span>
            </label>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="btn-primary"
            onClick={() => void publishStocksToWeb()}
            disabled={!isAdmin || driveBusy || !form.gdrive_refresh_token}
          >
            {form.gdrive_stocks_file_id ? 'Refresh Web Stocks Now' : 'Publish Stocks Now'}
          </button>
          <button
            className="btn-danger"
            onClick={() => void unpublishStocksFromWeb()}
            disabled={!isAdmin || driveBusy || !form.gdrive_stocks_file_id}
          >
            Unpublish (revoke public access)
          </button>
        </div>
      </div>
    </div>
  );
};
