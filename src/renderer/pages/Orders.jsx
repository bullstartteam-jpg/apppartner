import { useState, useEffect } from 'react';
import api from '../services/api';
import { notify } from '../components/Dialog';
import { UrlPreview, PreviewModal } from '../components/Preview';
import { isPreviewable } from '../utils/drive';
import {
  CreateTicketModal, TicketThreadModal, TicketStatusPill, fmtTime,
} from '../components/TicketModals';

// Orders assigned to this partner. Prices and the seller's identity are
// stripped by the API (PartnerController::orderIndex / showOrder), so nothing
// on this screen has to remember to hide them.
const STATUS_MAP = ['new_order', 'producing', 'wrongsize', 'fixed', 'reprint', 'onhold', 'shipped', 'cancelled'];

const FILTER_DEFAULTS = {
  status: '', system_id: '', system_ids: '', ref_id: '', line_id: '', sku: '',
  date_from: '', date_to: '', page: 1,
};

function TicketDot({ order }) {
  const total = order.tickets_count ?? 0;
  if (!total) return null;
  const open = order.open_tickets_count ?? 0;
  const cls = open > 0 ? 'bg-red-500' : 'bg-emerald-500';
  return (
    <span
      title={open > 0 ? `${open}/${total} ticket đang mở` : `${total} ticket đã xong`}
      className={`inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full ${cls} text-white text-[10px] leading-none`}
    >
      {total > 1 ? total : '💬'}
    </span>
  );
}

export default function Orders() {
  const [filters, setFilters] = useState(FILTER_DEFAULTS);
  const [list, setList] = useState({ data: [], last_page: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [detailId, setDetailId] = useState(null);
  const [ticketFor, setTicketFor] = useState(null);
  const [showIdsModal, setShowIdsModal] = useState(false);
  const [idsInput, setIdsInput] = useState('');

  const fetchList = async () => {
    setLoading(true);
    try {
      const params = { page: filters.page, per_page: 20 };
      for (const k of ['status', 'system_id', 'system_ids', 'ref_id', 'line_id', 'sku', 'date_from', 'date_to']) {
        if (filters[k] !== '' && filters[k] != null) params[k] = filters[k];
      }
      const res = await api.get('/partner/orders/list', { params });
      setList(res.data);
    } catch (err) {
      notify(err?.response?.data?.message || 'Không tải được đơn', { title: 'Orders', kind: 'error' });
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchList(); }, [filters.page, filters.status, filters.system_ids]);

  const search = (e) => { e.preventDefault(); setFilters(f => ({ ...f, page: 1 })); fetchList(); };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-neutral-800">Orders</h2>
        <span className="text-xs text-neutral-500">Tổng: {list.total ?? 0}</span>
      </div>

      <form onSubmit={search} className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-neutral-500 block">System ID</label>
          <input value={filters.system_id} onChange={e => setFilters(f => ({ ...f, system_id: e.target.value }))}
            className="mt-1 px-3 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm font-mono w-36" />
        </div>
        <div>
          <label className="text-xs text-neutral-500 block">Ref ID</label>
          <input value={filters.ref_id} onChange={e => setFilters(f => ({ ...f, ref_id: e.target.value }))}
            className="mt-1 px-3 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm w-36" />
        </div>
        <div>
          <label className="text-xs text-neutral-500 block">Line</label>
          <input value={filters.line_id} onChange={e => setFilters(f => ({ ...f, line_id: e.target.value }))}
            className="mt-1 px-3 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm font-mono w-24" />
        </div>
        <div>
          <label className="text-xs text-neutral-500 block">SKU</label>
          <input value={filters.sku} onChange={e => setFilters(f => ({ ...f, sku: e.target.value }))}
            className="mt-1 px-3 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm font-mono w-28" />
        </div>
        <div>
          <label className="text-xs text-neutral-500 block">Status</label>
          <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value, page: 1 }))}
            className="mt-1 px-3 py-1.5 bg-white border border-neutral-200 rounded-lg text-sm">
            <option value="">Tất cả</option>
            {STATUS_MAP.map((s, i) => <option key={i} value={i}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-neutral-500 block">Từ ngày</label>
          <input type="date" value={filters.date_from} onChange={e => setFilters(f => ({ ...f, date_from: e.target.value }))}
            className="mt-1 px-3 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm" />
        </div>
        <div>
          <label className="text-xs text-neutral-500 block">Đến ngày</label>
          <input type="date" value={filters.date_to} onChange={e => setFilters(f => ({ ...f, date_to: e.target.value }))}
            className="mt-1 px-3 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm" />
        </div>
        <button type="submit" className="px-4 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg">Search</button>
        <button type="button" onClick={() => { setIdsInput(filters.system_ids); setShowIdsModal(true); }}
          className={`px-3 py-1.5 text-xs rounded-lg ${filters.system_ids
            ? 'bg-orange-100 text-orange-700 border border-orange-300'
            : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-700'}`}>
          {filters.system_ids
            ? `System list (${filters.system_ids.split(/[\s,]+/).filter(Boolean).length})`
            : 'System List'}
        </button>
        {filters.system_ids && (
          <button type="button" onClick={() => setFilters(f => ({ ...f, system_ids: '', page: 1 }))}
            className="px-2 py-1.5 text-xs text-neutral-500 hover:text-red-500">✕</button>
        )}
        <button type="button" onClick={() => setFilters(FILTER_DEFAULTS)}
          className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm rounded-lg">Clear</button>
      </form>

      <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-neutral-500 text-xs border-b border-neutral-200 bg-[#faf8f6]">
              <th className="py-2 px-3 text-left">System ID</th>
              <th className="py-2 px-3 text-left">Ref ID</th>
              <th className="py-2 px-3 text-left">Sản phẩm</th>
              <th className="py-2 px-3 text-center">SL</th>
              <th className="py-2 px-3 text-left">Status</th>
              <th className="py-2 px-3 text-right">Doanh thu</th>
              <th className="py-2 px-3 text-left">Ngày tạo</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="py-6 text-center text-neutral-400">Đang tải…</td></tr>
            ) : list.data.length === 0 ? (
              <tr><td colSpan={7} className="py-6 text-center text-neutral-400">Không có đơn nào</td></tr>
            ) : list.data.map(o => (
              <tr key={o.id} onClick={() => setDetailId(o.id)}
                className="border-b border-neutral-100 hover:bg-orange-50/40 cursor-pointer">
                <td className="py-2 px-3 font-mono text-orange-500 text-xs">
                  <span className="inline-flex items-center gap-1">
                    {o.system_id}
                    <TicketDot order={o} />
                    <button onClick={e => { e.stopPropagation(); setTicketFor(o); }}
                      className="text-neutral-300 hover:text-blue-600 text-[11px] leading-none"
                      title="Tạo ticket cho đơn này">＋💬</button>
                  </span>
                </td>
                <td className="py-2 px-3 text-neutral-600 text-xs">{o.ref_id || '—'}</td>
                <td className="py-2 px-3 text-neutral-700 text-xs">
                  {(o.items || []).map(it => it.product_variant?.product?.name).filter(Boolean).join(', ') || '—'}
                </td>
                <td className="py-2 px-3 text-center text-neutral-600">
                  {(o.items || []).reduce((s, it) => s + (it.quantity || 0), 0)}
                </td>
                <td className="py-2 px-3 text-neutral-600 text-xs">{STATUS_MAP[o.status] ?? o.status}</td>
                <td className="py-2 px-3 text-right text-neutral-800">
                  {o.partner_revenue != null ? `$${Number(o.partner_revenue).toFixed(2)}` : '—'}
                </td>
                <td className="py-2 px-3 text-neutral-500 text-xs">
                  {o.created_at ? new Date(o.created_at).toLocaleDateString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {list.last_page > 1 && (
        <div className="flex justify-center items-center gap-2 text-sm">
          <button disabled={filters.page <= 1} onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}
            className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 disabled:opacity-40 rounded-lg">‹</button>
          <span className="text-neutral-600">Trang {filters.page} / {list.last_page}</span>
          <button disabled={filters.page >= list.last_page} onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}
            className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 disabled:opacity-40 rounded-lg">›</button>
        </div>
      )}

      {showIdsModal && (
        <div onClick={() => setShowIdsModal(false)} className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-6">
          <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-[90vw] max-w-lg p-5">
            <h3 className="text-base font-semibold text-neutral-800 mb-2">Tìm theo danh sách system_id</h3>
            <p className="text-xs text-neutral-500 mb-3">
              Dán system_id cách nhau bằng <b>xuống dòng</b> hoặc <b>dấu phẩy</b>. Khớp chính xác.
            </p>
            <textarea value={idsInput} onChange={e => setIdsInput(e.target.value)} rows={10}
              className="w-full px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm font-mono" />
            <div className="text-xs text-neutral-500 mt-2">
              Nhận diện: <b>{idsInput.split(/[\s,]+/).filter(Boolean).length}</b> system_id
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowIdsModal(false)} className="px-4 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm rounded-lg">Huỷ</button>
              <button onClick={() => { setFilters(f => ({ ...f, system_ids: idsInput, page: 1 })); setShowIdsModal(false); }}
                className="px-4 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg">Áp dụng</button>
            </div>
          </div>
        </div>
      )}

      {detailId && <OrderDetailModal id={detailId} onClose={() => setDetailId(null)} />}
      {ticketFor && (
        <CreateTicketModal orderId={ticketFor.id} systemId={ticketFor.system_id}
          onClose={() => setTicketFor(null)} onCreated={fetchList} />
      )}
    </div>
  );
}

/**
 * Order detail. Same shape as the admin order page minus price and seller —
 * the API already dropped those fields, this only renders what arrives.
 */
// Images to show for one item, in the order a printer wants them: the
// converted print files first (that is what goes on the press), then the
// source designs, then the mockups for reference.
const QR_KEY = /^(front|back|left|right|neck|special)_qr(_\d+)?$/;
const SOURCE_KEY = /^(front|back|left|right|neck|special)$/;

function itemThumbs(item) {
  const qr = [];
  const src = [];
  for (const m of item.metas || []) {
    if (!m.value || !isPreviewable(m.value)) continue;
    if (QR_KEY.test(m.key)) qr.push({ key: m.key, url: m.value, label: m.key });
    else if (SOURCE_KEY.test(m.key)) src.push({ key: m.key, url: m.value, label: `design ${m.key}` });
  }
  const mock = [];
  if (isPreviewable(item.mockup_front)) mock.push({ key: 'mf', url: item.mockup_front, label: 'mockup front' });
  if (isPreviewable(item.mockup_back)) mock.push({ key: 'mb', url: item.mockup_back, label: 'mockup back' });
  return [...qr, ...src, ...mock];
}

function OrderDetailModal({ id, onClose }) {
  const [order, setOrder] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [openTicketId, setOpenTicketId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);

  const loadTickets = async () => {
    try {
      const res = await api.get('/tickets', { params: { order_id: id, per_page: 50 } });
      setTickets(res.data?.data || []);
    } catch { /* secondary — never block the detail view */ }
  };

  useEffect(() => {
    api.get(`/partner/orders/${id}`)
      .then(res => setOrder(res.data.order))
      .catch(err => {
        notify(err?.response?.data?.message || 'Không mở được đơn', { title: 'Orders', kind: 'error' });
        onClose();
      });
    loadTickets();
  }, [id]);

  const Row = ({ label, value }) => (
    <div className="flex justify-between gap-3 text-sm py-1">
      <span className="text-neutral-500">{label}</span>
      <span className="text-neutral-800 text-right break-all">{value ?? '—'}</span>
    </div>
  );

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6">
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-[90vw] max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-200 flex justify-between items-center gap-3">
          <h3 className="text-sm font-semibold text-neutral-800 font-mono">{order?.system_id || 'Đang tải…'}</h3>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowCreate(true)}
              className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs rounded-lg">
              Tạo ticket{tickets.length ? ` (${tickets.length})` : ''}
            </button>
            <button onClick={onClose} className="text-neutral-500 hover:text-neutral-800 text-xl leading-none">×</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!order ? (
            <p className="text-neutral-400 text-sm">Đang tải…</p>
          ) : (
            <>
              <div className="border border-neutral-200 rounded-lg p-3">
                <h4 className="text-xs font-semibold text-neutral-600 mb-2">Thông tin đơn</h4>
                <Row label="System ID" value={order.system_id} />
                <Row label="Ref ID" value={order.ref_id} />
                <Row label="Status" value={STATUS_MAP[order.status] ?? order.status} />
                <Row label="Ship type" value={order.ship_type} />
                <Row label="Tracking" value={order.tracking_id} />
                <Row label="Doanh thu partner"
                  value={order.partner_revenue != null ? `$${Number(order.partner_revenue).toFixed(2)}` : '—'} />
                <Row label="Ngày tạo" value={order.created_at ? new Date(order.created_at).toLocaleString() : '—'} />
                {order.note && <Row label="Note" value={order.note} />}
              </div>

              <div className="border border-neutral-200 rounded-lg p-3">
                <h4 className="text-xs font-semibold text-neutral-600 mb-2">Items ({order.items?.length || 0})</h4>
                <div className="space-y-2">
                  {(order.items || []).map(it => {
                    const pv = it.product_variant;
                    const accs = (it.accessory_prices?.length ? it.accessory_prices : (it.accessory_price ? [it.accessory_price] : []))
                      .map(a => a.style || a.accessory_code || a.accessory?.name).filter(Boolean);
                    const thumbs = itemThumbs(it);
                    return (
                      <div key={it.id} className="text-sm border-t border-neutral-100 pt-2 first:border-0 first:pt-0">
                        <div className="text-neutral-800">
                          {pv?.product?.name || `Item #${it.id}`}
                          {(pv?.color || pv?.size) && <span className="text-neutral-500"> — {[pv.color, pv.size].filter(Boolean).join('/')}</span>}
                          <span className="text-neutral-500"> × {it.quantity}</span>
                        </div>
                        <div className="text-xs text-neutral-500 mt-0.5 flex flex-wrap gap-x-3">
                          {pv?.sku && <span className="font-mono">SKU {pv.sku}</span>}
                          {it.material?.name && <span>Material: {it.material.name}</span>}
                          {accs.length > 0 && <span>Add-on: {accs.join(', ')}</span>}
                        </div>
                        {thumbs.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {thumbs.map(t => (
                              <div key={t.key} className="text-center">
                                <UrlPreview url={t.url} onOpen={setPreviewUrl} label={t.label} size="sm" />
                                <div className="text-[10px] text-neutral-400 mt-0.5 font-mono">{t.label}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {order.address && (
                <div className="border border-neutral-200 rounded-lg p-3">
                  <h4 className="text-xs font-semibold text-neutral-600 mb-2">Địa chỉ giao</h4>
                  <div className="text-sm text-neutral-700">
                    {[order.address.first_name, order.address.last_name].filter(Boolean).join(' ')}<br />
                    {order.address.address_1}{order.address.address_2 ? `, ${order.address.address_2}` : ''}<br />
                    {[order.address.city, order.address.state, order.address.zipcode].filter(Boolean).join(' ')}<br />
                    {order.address.country}
                  </div>
                </div>
              )}

              {tickets.length > 0 && (
                <div className="border border-neutral-200 rounded-lg p-3">
                  <h4 className="text-xs font-semibold text-neutral-600 mb-2">Ticket ({tickets.length})</h4>
                  <ul className="divide-y divide-neutral-100">
                    {tickets.map(t => (
                      <li key={t.id} onClick={() => setOpenTicketId(t.id)}
                        className="py-2 flex items-center justify-between gap-3 cursor-pointer hover:bg-orange-50/40 -mx-2 px-2 rounded">
                        <div className="min-w-0 flex items-center gap-2 flex-wrap">
                          <span className="text-sm text-neutral-800 truncate">{t.subject}</span>
                          <TicketStatusPill status={t.status} />
                        </div>
                        <span className="text-xs text-neutral-500 shrink-0">{fmtTime(t.created_at)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      </div>

      {/* Stacked modals live OUTSIDE the detail overlay: nested inside, a click
          on their own backdrop would bubble into this overlay's onClick and
          close the order behind them. Later siblings also paint on top at the
          same z-index. */}
      {showCreate && order && (
        <CreateTicketModal orderId={order.id} systemId={order.system_id}
          onClose={() => setShowCreate(false)} onCreated={loadTickets} />
      )}
      {openTicketId && (
        <TicketThreadModal id={openTicketId} onClose={() => setOpenTicketId(null)} onChanged={loadTickets} />
      )}
      <PreviewModal url={previewUrl} onClose={() => setPreviewUrl(null)} />
    </>
  );
}
