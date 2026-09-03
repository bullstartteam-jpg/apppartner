import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { notify } from '../components/Dialog';
import { TicketThreadModal, TicketStatusPill, TICKET_PLATFORM, fmtTime } from '../components/TicketModals';

// Every thread this partner may read: the ones the seller raised (platform 1)
// and the ones between this partner and staff (platform 2), on orders assigned
// to them. Creating starts from an order, so there is no button here.
export default function Tickets() {
  const navigate = useNavigate();
  const [list, setList] = useState({ data: [], last_page: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [platform, setPlatform] = useState('');
  const [systemId, setSystemId] = useState('');
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [selected, setSelected] = useState([]);

  const tickets = list.data || [];

  const toggleSelect = (id) => setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const toggleSelectAll = () => {
    if (selected.length === tickets.length && tickets.length > 0) setSelected([]);
    else setSelected(tickets.map(t => t.id));
  };

  const fetchList = async (opts = {}) => {
    setLoading(true);
    try {
      const params = { page: opts.page ?? page, per_page: 20 };
      if (status) params.status = status;
      if (platform) params.platform = platform;
      if (systemId.trim()) params.system_id = systemId.trim();
      const res = await api.get('/tickets', { params });
      setList(res.data);
      setSelected([]);
    } catch (err) {
      notify(err?.response?.data?.message || 'Không tải được ticket', { title: 'Ticket', kind: 'error' });
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchList(); }, [page, status, platform]);

  const copySelected = (field, label) => {
    const vals = tickets.filter(t => selected.includes(t.id)).map(t =>
      field === 'system_id' ? (t.order?.system_id || String(t.order_id)) : String(t.id)
    ).filter(Boolean);
    navigator.clipboard.writeText(vals.join('\n'));
    notify(`Đã copy ${vals.length} ${label}`, { kind: 'success' });
  };

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

      {selected.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-2 flex items-center gap-3 text-sm">
          <span className="text-orange-700 font-medium">Đã chọn {selected.length} ticket</span>
          <button onClick={() => copySelected('system_id', 'System ID')}
            className="px-3 py-1 bg-white border border-neutral-200 hover:bg-neutral-50 rounded-lg text-neutral-700 text-xs">Copy System ID</button>
          <button onClick={() => copySelected('id', 'Ticket ID')}
            className="px-3 py-1 bg-white border border-neutral-200 hover:bg-neutral-50 rounded-lg text-neutral-700 text-xs">Copy Ticket ID</button>
          <button onClick={() => setSelected([])}
            className="ml-auto text-neutral-400 hover:text-neutral-700 text-xs">Bỏ chọn</button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-neutral-500 text-xs border-b border-neutral-200 bg-[#faf8f6]">
              <th className="py-2 px-3 w-8" onClick={e => e.stopPropagation()}>
                <input type="checkbox"
                  checked={tickets.length > 0 && selected.length === tickets.length}
                  onChange={toggleSelectAll}
                  className="accent-orange-500 cursor-pointer" />
              </th>
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
              <tr><td colSpan={8} className="py-6 text-center text-neutral-400">Đang tải…</td></tr>
            ) : tickets.length === 0 ? (
              <tr><td colSpan={8} className="py-6 text-center text-neutral-400">
                Chưa có ticket nào. Mở một đơn ở tab Orders và bấm <b>Tạo ticket</b>.
              </td></tr>
            ) : tickets.map(t => (
              <tr key={t.id} onClick={() => setOpenId(t.id)}
                className={`border-b border-neutral-100 hover:bg-orange-50/40 cursor-pointer ${selected.includes(t.id) ? 'bg-orange-50' : ''}`}>
                <td className="py-2 px-3" onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={selected.includes(t.id)} onChange={() => toggleSelect(t.id)}
                    className="accent-orange-500 cursor-pointer" />
                </td>
                <td className="py-2 px-3 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-orange-500">{t.order?.system_id || `#${t.order_id}`}</span>
                    <button title="Mở trang đơn hàng" onClick={e => { e.stopPropagation(); navigate('/orders', { state: { initSystemId: t.order?.system_id || '' } }); }}
                      className="text-neutral-400 hover:text-blue-500 leading-none select-none">↗</button>
                  </div>
                </td>
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
