import { useEffect, useMemo, useState } from 'react';
import type { DashboardStats } from '@shared/types';
import { apiRequest } from '../lib/api';
import { PageHeader } from '../components/PageHeader';
import { GroupedBarChart, HorizontalBarChart } from '../components/MiniCharts';
import { formatCurrency } from '../utils/format';

interface ActivityRow {
  id: number;
  action: string;
  entityType: string;
  description: string;
  createdAt: string;
}

const StatCard = ({ title, value }: { title: string; value: string }) => (
  <div className="card">
    <div className="text-sm text-slate-500">{title}</div>
    <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
  </div>
);

const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });

const TrendChart = ({ points }: { points: DashboardStats['monthlyTrend'] }) => {
  const data = points.map((p) => ({
    label: monthLabel(p.month),
    primary: Number(p.revenue || 0),
    secondary: Number(p.spend || 0)
  }));

  return (
    <GroupedBarChart
      data={data}
      primaryColor="#00a7e6"
      secondaryColor="#94a3b8"
      primaryLabel="Revenue"
      secondaryLabel="Material Spend"
      formatValue={(n) => formatCurrency(n)}
    />
  );
};

const TopGrossingChart = ({ items }: { items: DashboardStats['topGrossingItems'] }) => {
  const data = items.map((item) => ({
    label: item.itemName.length > 18 ? `${item.itemName.slice(0, 18)}...` : item.itemName,
    fullLabel: item.itemName,
    value: Number(item.revenue || 0),
    meta: `Qty: ${Number(item.quantity || 0)}`
  }));

  if (!data.length) {
    return <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">No invoice data yet.</div>;
  }

  return (
    <HorizontalBarChart
      data={data}
      color="#fb1e2c"
      formatValue={(n) => formatCurrency(n)}
    />
  );
};

const WiringStatusBars = ({ rows }: { rows: DashboardStats['wiring']['statusBreakdown'] }) => {
  const maxCount = Math.max(1, ...rows.map((r) => r.count));

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.status} className="grid grid-cols-[120px_1fr_45px] items-center gap-2 text-sm">
          <span className="text-slate-600">{row.status}</span>
          <div className="h-2.5 rounded-full bg-slate-200">
            <div
              className="h-2.5 rounded-full bg-brand-600"
              style={{ width: `${(row.count / maxCount) * 100}%` }}
              title={`${row.status}: ${row.count}`}
            />
          </div>
          <span className="text-right font-medium text-slate-700">{row.count}</span>
        </div>
      ))}
    </div>
  );
};

export const DashboardPage = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);

  const load = async () => {
    const [statData, actData] = await Promise.all([
      apiRequest<DashboardStats>('dashboard/stats'),
      apiRequest<ActivityRow[]>('activity/list', { limit: 12 })
    ]);

    setStats(statData);
    setActivity(actData);
  };

  useEffect(() => {
    void load();
  }, []);

  const yearlyRevenue = useMemo(
    () => (stats?.monthlyTrend || []).reduce((sum, row) => sum + Number(row.revenue || 0), 0),
    [stats]
  );
  const yearlySpend = useMemo(
    () => (stats?.monthlyTrend || []).reduce((sum, row) => sum + Number(row.spend || 0), 0),
    [stats]
  );
  const yearlyProfit = useMemo(() => yearlyRevenue - yearlySpend, [yearlyRevenue, yearlySpend]);

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Quick business overview" actions={<button className="btn-secondary" onClick={load}>Refresh</button>} />

      {!stats ? (
        <div className="card text-sm text-slate-500">Loading dashboard...</div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <StatCard title="Total Inventory Items" value={String(stats.totalInventoryItems)} />
            <StatCard title="Low Stock Items" value={String(stats.lowStockItems)} />
            <StatCard title="Active Jobs" value={String(stats.activeJobs)} />
            <StatCard title="Pending Estimates" value={String(stats.pendingEstimates)} />
            <StatCard title="Unpaid Invoices" value={String(stats.unpaidInvoices)} />
            <StatCard title="Monthly Revenue" value={formatCurrency(stats.monthlyRevenue)} />
            <StatCard title="Revenue (Last 12 Months)" value={formatCurrency(yearlyRevenue)} />
            <StatCard title="Material Spend (Last 12 Months)" value={formatCurrency(yearlySpend)} />
            <StatCard title="Gross Profit (Last 12 Months)" value={formatCurrency(yearlyProfit)} />
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="card xl:col-span-2">
              <div className="mb-3">
                <h2 className="text-base font-semibold">Revenue Monitoring (Monthly)</h2>
                <p className="text-xs text-slate-500">Invoice revenue compared with inventory purchase spend (LKR)</p>
              </div>
              <TrendChart points={stats.monthlyTrend} />
            </div>

            <div className="card">
              <h2 className="text-base font-semibold">Highest Grossing Items</h2>
              <p className="mt-1 text-xs text-slate-500">Lightweight chart based on invoice line revenue</p>
              <div className="mt-3">
                <TopGrossingChart items={stats.topGrossingItems} />
              </div>
              <div className="mt-3 space-y-2">
                {stats.topGrossingItems.map((item, idx) => (
                  <div key={item.itemKey} className="grid grid-cols-[24px_1fr_auto] items-center gap-2 rounded-md border border-slate-200 px-2 py-1.5 text-sm">
                    <span className="text-xs font-semibold text-slate-500">#{idx + 1}</span>
                    <span className="truncate font-medium text-slate-700">{item.itemName}</span>
                    <span className="text-slate-600">{formatCurrency(item.revenue)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="card">
              <h2 className="text-base font-semibold">Wiring Jobs</h2>
              <p className="mt-1 text-xs text-slate-500">Detected from wiring/cable keywords in job details</p>
              <div className="mt-4 space-y-3">
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Active Wiring Jobs</div>
                  <div className="mt-1 text-xl font-semibold text-slate-900">{stats.wiring.activeJobs}</div>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Completed This Month</div>
                  <div className="mt-1 text-xl font-semibold text-slate-900">{stats.wiring.completedThisMonth}</div>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Wiring Revenue This Month</div>
                  <div className="mt-1 text-xl font-semibold text-slate-900">{formatCurrency(stats.wiring.revenueThisMonth)}</div>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Avg Completed Wiring Job Value</div>
                  <div className="mt-1 text-xl font-semibold text-slate-900">
                    {formatCurrency(stats.wiring.averageCompletedJobValue)}
                  </div>
                </div>
              </div>
            </div>

            <div className="card xl:col-span-2">
              <h2 className="text-base font-semibold">Wiring Job Status Mix</h2>
              <p className="mt-1 text-xs text-slate-500">Track pipeline stages for wiring-related jobs</p>
              <div className="mt-4">
                <WiringStatusBars rows={stats.wiring.statusBreakdown} />
              </div>
            </div>
          </div>
        </>
      )}

      <div className="mt-5 card">
        <h2 className="text-base font-semibold">Recent Activity</h2>
        <div className="mt-3 table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {activity.length ? (
                activity.map((row) => (
                  <tr key={row.id}>
                    <td>{new Date(row.createdAt).toLocaleString()}</td>
                    <td>{row.action}</td>
                    <td>{row.entityType}</td>
                    <td>{row.description}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="text-center text-slate-500">
                    No recent activity.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
