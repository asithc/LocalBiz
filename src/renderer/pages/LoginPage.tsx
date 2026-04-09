import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useUiStore } from '../store/uiStore';
import { BRAND } from '@shared/branding';

export const LoginPage = () => {
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const notify = useUiStore((s) => s.notify);

  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(username, password);
      notify('success', 'Logged in successfully.');
      navigate('/');
    } catch (error) {
      notify('error', (error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <img src={BRAND.logoSymbol} alt="Jayakula Brothers" className="h-14 w-auto object-contain" />
        <h1 className="mt-3 text-2xl font-bold text-slate-900">LocalBiz Desk</h1>
        <p className="mt-1 text-sm text-slate-500">Local Inventory, Jobs, Estimation & Invoicing App</p>
        <div className="brand-accent-bar mt-4 h-1 w-full rounded-full" />

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Username</label>
            <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Password</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button className="btn-primary w-full" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="mt-4 text-xs text-slate-500">Default admin: admin / admin123</p>
        <p className="mt-1 text-xs text-slate-400">Security: account lockout activates after repeated failed login attempts.</p>
      </div>
    </div>
  );
};
