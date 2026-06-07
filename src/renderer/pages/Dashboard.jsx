import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

// Partner dashboard: totals for the gangsheets assigned to this partner.
export default function Dashboard() {
  const [stats, setStats] = useState({ total_gangsheets: 0, total_orders: 0, total_metas: 0 });
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    api.get('/partner/dashboard')
      .then(res => setStats(res.data))
      .finally(() => setLoading(false));
  };
  useEffect(() => { refresh(); }, []);

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-neutral-800">Dashboard</h2>
          <p className="text-xs text-neutral-500 mt-1">Tổng quan các gangsheet được phân quyền cho bạn.</p>
        </div>
        <button onClick={refresh} className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm rounded-lg">
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label="Tổng gangsheet" value={stats.total_gangsheets} color="orange" loading={loading} />
        <StatCard label="Tổng đơn" value={Number(stats.total_orders).toLocaleString()} color="neutral" loading={loading} sub="đơn trong các gang được phân quyền" />
        <StatCard label="Tổng design (_qr)" value={Number(stats.total_metas).toLocaleString()} color="neutral" loading={loading} />
      </div>

      <div className="bg-white rounded-xl border border-neutral-200 shadow-sm p-4">
        <p className="text-sm text-neutral-600">
          Xem chi tiết các gangsheet được phân quyền tại{' '}
          <Link to="/gangsheet" className="text-orange-600 hover:text-orange-700 font-medium">Gangsheet →</Link>
        </p>
      </div>
    </div>
  );
}

function StatCard({ label, value, color, loading, sub }) {
  const palette = {
    neutral: 'bg-white text-neutral-800',
    orange:  'bg-orange-50 text-orange-700 border-orange-200',
  }[color] || 'bg-white text-neutral-800';
  return (
    <div className={`rounded-xl border border-neutral-200 p-4 shadow-sm ${palette}`}>
      <div className="text-xs uppercase tracking-wider opacity-75">{label}</div>
      <div className="text-2xl font-bold mt-1">{loading ? '…' : value}</div>
      {sub && <div className="text-[10px] opacity-60 mt-0.5">{sub}</div>}
    </div>
  );
}
