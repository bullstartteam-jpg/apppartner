import { useEffect, useState } from 'react';
import api from '../services/api';

/**
 * What the partner has been paid, and what is still owed.
 *
 * Read-only: payouts are recorded by admin. The partner sees the same figures
 * the admin side computes — having to ask for a screenshot of someone else's
 * screen is not a record.
 */
const fmt$ = (n) => `$${Number(n || 0).toFixed(2)}`;

const METHOD_LABELS = {
  bank_transfer: 'Chuyển khoản',
  cash: 'Tiền mặt',
  momo: 'Momo',
  paypal: 'PayPal',
};

export default function Payouts() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(null);

  /**
   * Tell admin the money arrived. Recording a payment and receiving it are two
   * different facts — without this, a transfer that failed or went to the wrong
   * account looks exactly like one that landed.
   */
  const confirmReceipt = async (row) => {
    if (!confirm(`Xác nhận bạn đã nhận ${fmt$(row.amount)}?`)) return;
    const note = prompt('Ghi chú (không bắt buộc):', '') ?? '';
    setConfirming(row.id);
    try {
      const res = await api.post(`/partner/payouts/${row.id}/confirm`, { note: note || null });
      alert(res.data?.message || 'Đã xác nhận');
      load();
    } catch (err) {
      alert(err?.response?.data?.message || 'Xác nhận thất bại');
    } finally { setConfirming(null); }
  };

  const load = () => {
    setLoading(true);
    api.get('/partner/payouts')
      .then(res => setData(res.data))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const rows = data?.payouts || [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-neutral-800">Thanh toán</h2>
          <p className="text-xs text-neutral-500 mt-1">Tiền bạn đã nhận và phần còn lại.</p>
        </div>
        <button onClick={load} className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm rounded-lg">
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Đã tính" value={fmt$(data?.earned)} color="neutral" loading={loading}
          sub={`${Number(data?.orders || 0).toLocaleString()} đơn đã ship`} />
        <StatCard label="Đã nhận" value={fmt$(data?.paid)} color="green" loading={loading}
          sub={`${rows.length} giao dịch`} />
        <StatCard label="Còn lại" value={fmt$(data?.owed)} color="orange" loading={loading}
          sub={Number(data?.owed) < 0 ? 'đã nhận trước phần này' : 'chưa nhận'} />
      </div>

      {rows.some(r => !r.confirmed_at) && (
        <p className="text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
          Có {rows.filter(r => !r.confirmed_at).length} giao dịch chưa được bạn xác nhận — kiểm tra tài khoản
          rồi bấm <b>Xác nhận đã nhận</b> ở bảng dưới.
        </p>
      )}

      {/* Shipped with no amount set yet — owed something, but not counted in
          "Đã tính" until admin prices it. Saying so beats a total that quietly
          leaves work out. */}
      {data?.unpriced > 0 && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {data.unpriced} đơn đã ship nhưng chưa được tính tiền — chưa nằm trong "Đã tính".
        </p>
      )}

      <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-200 text-sm font-semibold text-neutral-700">
          Lịch sử giao dịch
        </div>
        {loading ? (
          <p className="p-6 text-center text-neutral-400 text-sm">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-center text-neutral-400 text-sm">Chưa có giao dịch nào.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#faf8f6] text-neutral-500 text-xs">
              <tr className="border-b border-neutral-200">
                <th className="text-left px-3 py-2">Ngày</th>
                <th className="text-right px-3 py-2">Số tiền</th>
                <th className="text-left px-3 py-2">Hình thức</th>
                <th className="text-left px-3 py-2">Mã GD</th>
                <th className="text-left px-3 py-2">Kỳ</th>
                <th className="text-left px-3 py-2">Ghi chú</th>
                <th className="text-right px-3 py-2">Còn lại sau</th>
                <th className="text-left px-3 py-2">Xác nhận</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id} className="border-b border-neutral-100">
                  <td className="px-3 py-2 text-neutral-500 text-xs">{new Date(row.created_at).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right font-semibold text-emerald-700">{fmt$(row.amount)}</td>
                  <td className="px-3 py-2 text-neutral-600 text-xs">{METHOD_LABELS[row.method] || row.method || '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs text-neutral-500">{row.transaction_id || '—'}</td>
                  <td className="px-3 py-2 text-neutral-500 text-xs">
                    {row.period_from || row.period_to ? `${row.period_from || '…'} → ${row.period_to || '…'}` : '—'}
                  </td>
                  <td className="px-3 py-2 text-neutral-500 text-xs">{row.note || '—'}</td>
                  <td className="px-3 py-2 text-right text-neutral-500 text-xs">{fmt$(row.balance_after)}</td>
                  <td className="px-3 py-2 text-xs">
                    {row.confirmed_at ? (
                      <span className="text-emerald-700" title={row.confirmed_note || ''}>
                        ✓ đã nhận · {new Date(row.confirmed_at).toLocaleDateString()}
                      </span>
                    ) : (
                      <button onClick={() => confirmReceipt(row)} disabled={confirming === row.id}
                        className="px-2 py-1 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white rounded">
                        {confirming === row.id ? 'Đang gửi…' : 'Xác nhận đã nhận'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color, loading, sub }) {
  const palette = {
    neutral: 'bg-white text-neutral-800',
    orange: 'bg-orange-50 text-orange-700 border-orange-200',
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  }[color] || 'bg-white text-neutral-800';

  return (
    <div className={`rounded-xl border border-neutral-200 p-4 shadow-sm ${palette}`}>
      <div className="text-xs uppercase tracking-wider opacity-75">{label}</div>
      <div className="text-2xl font-bold mt-1">{loading ? '…' : value}</div>
      {sub && <div className="text-[10px] opacity-60 mt-0.5">{sub}</div>}
    </div>
  );
}
