import { useState, useEffect } from 'react';
import api from '../services/api';
import { notify } from '../components/Dialog';
import { TicketThreadModal, TicketStatusPill, TICKET_PLATFORM, fmtTime } from '../components/TicketModals';

// Every thread this partner may read: the ones the seller raised (platform 1)
// and the ones between this partner and staff (platform 2), on orders assigned
// to them. Creating starts from an order, so there is no button here.
export default function Tickets() {
  const [list, setList] = useState({ data: [], last_page: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [platform, setPlatform] = useState('');
  const [systemId, setSystemId] = useState('');
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);

  const fetchList = async (opts = {}) => {
    setLoading(true);
    try {
      const params = { page: opts.page ?? page, per_page: 20 };
      if (status) params.status = status;
      if (platform) params.platform = platform;
      if (systemId.trim()) params.system_id = systemId.trim();
      const res = await api.get('/tickets', { params });
      setList(res.data);
    } catch (err) {
      notify(err?.response?.data?.message || 'Không tải được ticket', { title: 'Ticket', kind: 'error' });
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchList(); }, [page, status, platform]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-neutral-800">Ticket</h2>
        <span className="text-xs text-neutral-500">Tổng: {list.total ?? 0}</span>
      </div>

      <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-neutral-500 block">System ID</label>
          <input value={systemId} onChange={e => setSystemId(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { setPage(1); fetchList({ page: 1 }); } }}
            className="mt-1 px-3 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm font-mono w-40" />
        </div>
        <div>
          <label className="text-xs text-neutral-500 block">Trạng thái</label>
          <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}
            className="mt-1 px-3 py-1.5 bg-white border border-neutral-200 rounded-lg text-sm">
            <option value="">Tất cả</option>
            <option value="1">Đang mở</option>
            <option value="3">Tin mới</option>
            <option value="2">Đã xong</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-neutral-500 block">Loại</label>
          <select value={platform} onChange={e => { setPlatform(e.target.value); setPage(1); }}
            className="mt-1 px-3 py-1.5 bg-white border border-neutral-200 rounded-lg text-sm">
            <option value="">Tất cả</option>
            <option value="1">Seller tạo</option>
            <option value="2">Partner tạo</option>
          </select>
        </div>
        <button onClick={() => { setPage(1); fetchList({ page: 1 }); }}
          className="px-4 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg">Tìm</button>
      </div>

      <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-neutral-500 text-xs border-b border-neutral-200 bg-[#faf8f6]">
              <th className="py-2 px-3 text-left">Order</th>
              <th className="py-2 px-3 text-left">Tiêu đề</th>
              <th className="py-2 px-3 text-left">Người tạo</th>
              <th className="py-2 px-3 text-left">Loại</th>
              <th className="py-2 px-3 text-center">Trả lời</th>
              <th className="py-2 px-3 text-left">Trạng thái</th>
              <th className="py-2 px-3 text-left">Tạo lúc</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="py-6 text-center text-neutral-400">Đang tải…</td></tr>
            ) : list.data.length === 0 ? (
              <tr><td colSpan={7} className="py-6 text-center text-neutral-400">
                Chưa có ticket nào. Mở một đơn ở tab Orders và bấm <b>Tạo ticket</b>.
              </td></tr>
            ) : list.data.map(t => (
              <tr key={t.id} onClick={() => setOpenId(t.id)}
                className="border-b border-neutral-100 hover:bg-orange-50/40 cursor-pointer">
                <td className="py-2 px-3 font-mono text-orange-500 text-xs">{t.order?.system_id || `#${t.order_id}`}</td>
                <td className="py-2 px-3 text-neutral-800">{t.subject}</td>
                <td className="py-2 px-3 text-neutral-600">{t.creator?.name || '—'}</td>
                <td className="py-2 px-3 text-neutral-600">{TICKET_PLATFORM[t.platform] || t.platform}</td>
                <td className="py-2 px-3 text-center text-neutral-600">{t.items_count ?? 0}</td>
                <td className="py-2 px-3"><TicketStatusPill status={t.status} /></td>
                <td className="py-2 px-3 text-neutral-500 text-xs">{fmtTime(t.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {list.last_page > 1 && (
        <div className="flex justify-center items-center gap-2 text-sm">
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
            className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 disabled:opacity-40 rounded-lg">‹</button>
          <span className="text-neutral-600">Trang {page} / {list.last_page}</span>
          <button disabled={page >= list.last_page} onClick={() => setPage(p => p + 1)}
            className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 disabled:opacity-40 rounded-lg">›</button>
        </div>
      )}

      {openId && <TicketThreadModal id={openId} onClose={() => setOpenId(null)} onChanged={() => fetchList()} />}
    </div>
  );
}
