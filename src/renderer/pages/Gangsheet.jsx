import { useEffect, useState } from 'react';
import api from '../services/api';

// Read-only gangsheet list for partners — only the gangs an admin assigned to
// them (backend /partner/gangsheets is already scoped). Mirrors the bullstart
// Manage tab layout but without create/delete.
export default function Gangsheet() {
  const [filters, setFilters] = useState({ date_from: '', date_to: '', line_id: '', page: 1 });
  const [list, setList] = useState({ data: [], current_page: 1, last_page: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);

  const fetchList = () => {
    setLoading(true);
    const params = { page: filters.page, per_page: 20 };
    if (filters.date_from) params.date_from = filters.date_from;
    if (filters.date_to) params.date_to = filters.date_to;
    if (filters.line_id) params.line_id = filters.line_id;
    api.get('/partner/gangsheets', { params })
      .then(res => setList(res.data))
      .finally(() => setLoading(false));
  };
  useEffect(() => { fetchList(); }, [filters.page]);

  const applyFilters = (e) => { e?.preventDefault(); setFilters(f => ({ ...f, page: 1 })); setTimeout(fetchList, 0); };
  const clearFilters = () => { setFilters({ date_from: '', date_to: '', line_id: '', page: 1 }); setTimeout(fetchList, 0); };

  const openLink = (url) => {
    if (window.electronAPI?.openExternal) window.electronAPI.openExternal(url);
    else window.open(url, '_blank');
  };

  const togglePrinted = async (g) => {
    const printed = !g.pivot?.printed_at;
    // optimistic update
    setList(prev => ({
      ...prev,
      data: prev.data.map(x => x.id === g.id
        ? { ...x, pivot: { ...x.pivot, printed_at: printed ? new Date().toISOString() : null } }
        : x),
    }));
    try {
      await api.post(`/partner/gangsheets/${g.id}/printed`, { printed });
    } catch {
      fetchList(); // revert on error
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-xl font-bold text-neutral-800">Gangsheet</h2>
        <p className="text-xs text-neutral-500 mt-1">Các gangsheet được phân quyền cho bạn.</p>
      </div>

      {/* Filters */}
      <form onSubmit={applyFilters} className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-neutral-500 block">From</label>
          <input type="date" value={filters.date_from} onChange={e => setFilters(f => ({ ...f, date_from: e.target.value }))}
            className="mt-1 px-3 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm" />
        </div>
        <div>
          <label className="text-xs text-neutral-500 block">To</label>
          <input type="date" value={filters.date_to} onChange={e => setFilters(f => ({ ...f, date_to: e.target.value }))}
            className="mt-1 px-3 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm" />
        </div>
        <div>
          <label className="text-xs text-neutral-500 block">Line ID</label>
          <input type="text" value={filters.line_id} onChange={e => setFilters(f => ({ ...f, line_id: e.target.value }))} placeholder="e.g. GC"
            className="mt-1 w-32 px-3 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm font-mono" />
        </div>
        <button type="submit" className="px-4 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg">Apply</button>
        <button type="button" onClick={clearFilters} className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm rounded-lg">Clear</button>
        <span className="text-xs text-neutral-500 ml-auto">Total: {list.total ?? 0}</span>
      </form>

      {/* Table */}
      <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-neutral-500 text-xs bg-[#faf8f6] border-b border-neutral-200">
              <th className="px-3 py-2 text-left">Filename</th>
              <th className="px-3 py-2 text-left">Range</th>
              <th className="px-3 py-2 text-left">Line</th>
              <th className="px-3 py-2 text-right">Orders</th>
              <th className="px-3 py-2 text-right">Metas</th>
              <th className="px-3 py-2 text-center">Đã in</th>
              <th className="px-3 py-2 text-left">When</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="p-6 text-center text-neutral-400">Loading…</td></tr>
            ) : list.data.length === 0 ? (
              <tr><td colSpan={8} className="p-6 text-center text-neutral-400">Chưa có gangsheet nào được phân quyền.</td></tr>
            ) : list.data.map(g => (
              <tr key={g.id} className="border-b border-neutral-100 hover:bg-orange-50/30">
                <td className="px-3 py-2 font-mono text-xs text-neutral-700 truncate max-w-[260px]">{g.filename}</td>
                <td className="px-3 py-2 font-mono text-xs text-neutral-500">
                  {g.first_system_id}{g.first_system_id !== g.last_system_id && <> → {g.last_system_id}</>}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{g.line_id || '-'}</td>
                <td className="px-3 py-2 text-right">{g.orders_count}</td>
                <td className="px-3 py-2 text-right">{g.metas_count}</td>
                <td className="px-3 py-2 text-center">
                  <input type="checkbox" checked={!!g.pivot?.printed_at} onChange={() => togglePrinted(g)}
                    className="accent-green-600 w-4 h-4" title={g.pivot?.printed_at ? `Đã in ${new Date(g.pivot.printed_at).toLocaleString()}` : 'Tích khi in xong'} />
                </td>
                <td className="px-3 py-2 text-xs text-neutral-500">{new Date(g.created_at).toLocaleString()}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex gap-3 justify-end">
                    <button onClick={() => setDetail(g)} className="text-xs text-neutral-600 hover:text-neutral-800">Detail</button>
                    <button onClick={() => openLink(g.file_url)} className="text-xs text-orange-500 hover:text-orange-600">Download</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {list.last_page > 1 && (
        <div className="flex justify-between items-center text-xs text-neutral-500">
          <span>Page {list.current_page} / {list.last_page} • {list.total} gangsheet(s)</span>
          <div className="flex gap-1">
            <button disabled={filters.page <= 1} onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}
              className="px-2 py-1 border border-neutral-200 rounded disabled:opacity-40">Prev</button>
            <button disabled={filters.page >= list.last_page} onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}
              className="px-2 py-1 border border-neutral-200 rounded disabled:opacity-40">Next</button>
          </div>
        </div>
      )}

      {detail && <DetailModal gs={detail} onClose={() => setDetail(null)} openLink={openLink} />}
    </div>
  );
}

function DetailModal({ gs, onClose, openLink }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/partner/gangsheets/${gs.id}`).then(res => setData(res.data)).finally(() => setLoading(false));
  }, [gs.id]);

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6">
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-[90vw] max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-200 flex justify-between items-center">
          <div>
            <h3 className="text-sm font-semibold text-neutral-800 font-mono">{gs.filename}</h3>
            <p className="text-xs text-neutral-500 mt-0.5">{gs.orders_count} orders · {gs.metas_count} metas · {new Date(gs.created_at).toLocaleString()}</p>
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-800 text-xl leading-none">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <button onClick={() => openLink(gs.file_url)} className="mb-3 text-orange-500 text-xs break-all hover:underline">{gs.file_url}</button>
          {loading ? (
            <p className="text-neutral-400 text-sm">Loading…</p>
          ) : !data || data.orders.length === 0 ? (
            <p className="text-neutral-400 text-sm">No orders.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-neutral-500 text-xs border-b border-neutral-200">
                  <th className="py-2 text-left">System ID</th>
                  <th className="py-2 text-left">Ref</th>
                  <th className="py-2 text-right">Total</th>
                  <th className="py-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.map(o => (
                  <tr key={o.id} className="border-b border-neutral-100">
                    <td className="py-1.5 font-mono text-orange-500 text-xs">{o.system_id}</td>
                    <td className="py-1.5 text-xs text-neutral-600">{o.ref_id || '-'}</td>
                    <td className="py-1.5 text-right">${o.total_cost}</td>
                    <td className="py-1.5 text-right text-xs">{o.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
