import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { BRAND } from '@shared/branding';

type NavIconName =
  | 'dashboard'
  | 'inventory'
  | 'customers'
  | 'suppliers'
  | 'estimates'
  | 'jobs'
  | 'invoices'
  | 'staff'
  | 'settings';

const NavIcon = ({ name, className = 'h-4 w-4' }: { name: NavIconName; className?: string }) => {
  if (name === 'dashboard') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M3 12h8V3H3v9Zm10 9h8v-6h-8v6Zm0-8h8V3h-8v10ZM3 21h8v-7H3v7Z" fill="currentColor" />
      </svg>
    );
  }
  if (name === 'inventory') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M3 7.5 12 3l9 4.5-9 4.5L3 7.5Zm0 4.5 9 4.5 9-4.5M3 16.5 12 21l9-4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === 'customers') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M16 19a4 4 0 0 0-8 0M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8 6a4 4 0 0 0-3-3.87M18 11a4 4 0 1 0-2.2-7.34" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === 'suppliers') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path
          d="M4 7.5 12 4l8 3.5v9L12 20l-8-3.5v-9Zm8 4.5v8M8 9l4 1.8L16 9"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (name === 'estimates') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M7 3h7l5 5v13H7V3Zm7 0v5h5M10 13h6M10 17h4M10 9h2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === 'jobs') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M10 4h4l1 2h5v12H4V6h5l1-2Zm-1 9 2 2 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === 'invoices') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 6h6M9 12h6M9 15h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === 'staff') {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
        <path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 20a5 5 0 0 1 10 0M11 20a5 5 0 0 1 10 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="m12 3 2 2.5 3.2.6.7 3.2 2.6 2.2-1.8 2.8 1 3.2-3.1 1.1-1.4 3-3.2-.8-3.2.8-1.4-3-3.1-1.1 1-3.2-1.8-2.8 2.6-2.2.7-3.2L10 5.5 12 3Zm0 6.5v5m0 2.5h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

const links = [
  { to: '/', label: 'Dashboard', icon: 'dashboard' as const },
  { to: '/inventory', label: 'Inventory', icon: 'inventory' as const },
  { to: '/customers', label: 'Customers', icon: 'customers' as const },
  { to: '/suppliers', label: 'Suppliers', icon: 'suppliers' as const },
  { to: '/estimates', label: 'Estimates', icon: 'estimates' as const },
  { to: '/jobs', label: 'Jobs', icon: 'jobs' as const },
  { to: '/invoices', label: 'Invoices', icon: 'invoices' as const },
  { to: '/staff', label: 'Staff', icon: 'staff' as const },
  { to: '/settings', label: 'Settings', icon: 'settings' as const }
];

export const AppLayout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { session, logout } = useAuthStore();

  return (
    <div className="flex min-h-screen bg-slate-100">
      <aside className="w-64 border-r border-slate-200 bg-white p-4">
        <Link to="/" className="mb-6 block">
          <img src={BRAND.logoSymbol} alt="Jayakula Brothers" className="h-10 w-auto object-contain" />
          <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-brand-700">LocalBiz Desk</div>
        </Link>
        <nav className="flex flex-col gap-1">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
                  isActive
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`
              }
            >
              <NavIcon name={link.icon} />
              <span>{link.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="flex-1">
        <div className="brand-accent-bar h-1 w-full" />
        <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-5">
          <div className="text-sm font-medium text-slate-700">{links.find((l) => l.to === location.pathname)?.label || 'Module'}</div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-500">
              {session?.username} ({session?.role})
            </span>
            <button
              className="btn-secondary"
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
            >
              Logout
            </button>
          </div>
        </header>

        <div className="p-5">
          <Outlet />
        </div>
      </main>
    </div>
  );
};
