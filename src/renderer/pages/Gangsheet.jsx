import { useEffect, useState } from 'react';
import api from '../services/api';
import {
  buildGangsheetForChunk, chunkArray, flattenQrMetas, isQrKey,
  splitOrdersBySideCount, getGangPageFormat, setGangPageFormat,
} from '../services/gangsheetBuilder';

// ─────────────────────────────── shared UI ───────────────────────────────

function TabBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        active ? 'border-orange-500 text-orange-600' : 'border-transparent text-neutral-500 hover:text-neutral-700'
      }`}
    >{children}</button>
  );
}

// Pill-style sub-tab chip (page-format + category filters). Mirrors bullstart.
function SubChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full transition-colors ${
        active
          ? 'bg-orange-500 text-white'
          : 'bg-neutral-100 text-neutral-600 hover:bg-orange-50 hover:text-orange-700'
      }`}
    >{children}</button>
  );
}

function CountBadge({ n }) {
  return <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-black/10">{n}</span>;
}

// Per-machine gang page-format selector (persisted in localStorage by the builder).
function PageFormatSelect() {
  const [fmt, setFmt] = useState(getGangPageFormat());
  return (
    <div>
      <label className="text-xs text-neutral-500 block">Khổ giấy</label>
      <select value={fmt} onChange={e => { setFmt(e.target.value); setGangPageFormat(e.target.value); }}
        className="mt-1 px-3 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm">
        <option value="original">Default (10×7)</option>
        <option value="letter">Letter 11×8.5</option>
      </select>
    </div>
  );
}

// Category of a gangsheet, parsed from the filename tail after the date token
// (MMMDD), e.g. "..._JUN06_gloss-300gsm.pdf" → "gloss-300gsm". No suffix → ''.
function gangCategory(filename) {
  const m = String(filename || '').match(/_[A-Za-z]{3}\d{2}_(.+)\.pdf$/i);
  return m ? m[1] : '';
}
const gangCategoryLabel = (cat) => cat ? cat.replace(/_/g, ' · ') : 'Khác';

// An order's material = first item that has one. Mirrors the bullstart bucket rule.
function orderMaterial(order) {
  for (const it of order.items || []) {
    const id = it.material_id ?? it.material?.id;
    if (id) return { id, name: it.material?.name || '' };
  }
  return { id: 0, name: '' };
}

// "Scratch Card" → "scratch-card" — filename-safe token.
function slugifyAccessory(name) {
  return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
}

function dominantLineId(orders) {
  const counts = {};
  for (const o of orders) for (const it of o.items || []) {
    const li = it.product_variant?.product?.line_id;
    if (li) counts[li] = (counts[li] || 0) + 1;
  }
  let best = '', max = -1;
  for (const [k, v] of Object.entries(counts)) if (v > max) { max = v; best = k; }
  return best;
}

// Count all _qr metas of an order (includeProduced — partner orders are produced).
function countQrMetas(order) {
  let n = 0;
  for (const it of order.items || []) for (const m of it.metas || [])
    if (isQrKey(m.key)) n++;
  return n;
}

// ─────────────────────────────── page shell ───────────────────────────────

// Partner gangsheet workspace. The partner is a print shop: they re-gang and
// reconvert the orders that sit inside the gangsheets an admin assigned to them
// (GET /partner/orders is scoped to those order ids), and review the assigned
// gangs. They never reach orders that aren't theirs.
export default function Gangsheet() {
  const [tab, setTab] = useState('compose');
  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-xl font-bold text-neutral-800">Gangsheet</h2>
        <p className="text-xs text-neutral-500 mt-1">Tạo / in lại gangsheet từ các đơn được giao cho bạn.</p>
      </div>

      <div className="flex gap-2 border-b border-neutral-200">
        <TabBtn active={tab === 'compose'} onClick={() => setTab('compose')}>Compose</TabBtn>
        <TabBtn active={tab === 'reconvert'} onClick={() => setTab('reconvert')}>Reconvert</TabBtn>
        <TabBtn active={tab === 'manage'} onClick={() => setTab('manage')}>Đã chia</TabBtn>
      </div>

      {tab === 'compose' && <ComposeTab />}
      {tab === 'reconvert' && <ReconvertTab />}
      {tab === 'manage' && <ManageTab />}
    </div>
  );
}

// ─────────────────────────────── Compose ───────────────────────────────

// Re-gang the partner's assigned orders into a fresh PDF, upload to B2, and
// record it (auto-assigned back to this partner). includeProduced=true because
// these orders were already produced by the admin when first ganged.
function ComposeTab() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [batchSize, setBatchSize] = useState(() => {
    const v = parseInt(localStorage.getItem('gangsheet_batch_size'), 10);
    return Number.isFinite(v) && v > 0 ? v : 10;
  });
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState([]);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const res = await api.get('/partner/orders');
      const list = res.data.orders || [];
      setOrders(list);
      setSelectedIds(new Set(list.map(o => o.id)));
    } finally { setLoading(false); }
  };
  useEffect(() => { fetchOrders(); }, []);

  const toggle = (id) => setSelectedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => {
    if (selectedIds.size === orders.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(orders.map(o => o.id)));
  };

  const handleGenerate = async () => {
    const selected = orders.filter(o => selectedIds.has(o.id));
    if (selected.length === 0) { alert('Chọn ít nhất 1 đơn'); return; }
    if (!window.electronAPI?.s3Upload) {
      alert('Tạo gangsheet cần chạy trong app desktop (Electron).');
      return;
    }

    // Split by material first (never mix paper stock), then by side count.
    const matGroups = new Map();   // matId → { name, orders[] }
    for (const o of selected) {
      const m = orderMaterial(o);
      if (!matGroups.has(m.id)) matGroups.set(m.id, { name: m.name, orders: [] });
      matGroups.get(m.id).orders.push(o);
    }
    const joinTags = (...xs) => xs.filter(Boolean).join('_');
    const chunks = [];
    for (const [matId, { name, orders: matOrders }] of matGroups) {
      const matTag = matId ? slugifyAccessory(name) : '';
      const { oneSide, twoSide } = splitOrdersBySideCount(matOrders, { includeProduced: true });
      for (const chunk of chunkArray(oneSide, batchSize)) chunks.push({ chunk, suffix: joinTags(matTag, '') });
      for (const chunk of chunkArray(twoSide, batchSize)) chunks.push({ chunk, suffix: joinTags(matTag, 'two_size') });
    }

    setRunning(true); setResults([]);
    const out = [];
    try {
      const credsRes = await api.get('/partner/storage-credentials');
      const creds = credsRes.data;

      for (let ci = 0; ci < chunks.length; ci++) {
        const { chunk, suffix } = chunks[ci];
        const linePrefix = dominantLineId(chunk);
        const totalInChunk = flattenQrMetas(chunk, { includeProduced: true }).length;
        setProgress({ chunkIndex: ci, totalChunks: chunks.length, done: 0, total: totalInChunk, system_id: '', key: '' });

        const built = await buildGangsheetForChunk(chunk, {
          linePrefix,
          includeProduced: true,
          nameSuffix: suffix,
          seq: ci + 1,
          pageFormat: getGangPageFormat(),
          onProgress: (p) => setProgress(prev => ({ ...prev, ...p })),
        });

        const key = `${creds.folder}/${built.filename}`;
        const arrayBuffer = await built.blob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        await window.electronAPI.s3Upload({
          credentials: creds,
          bucket: creds.bucket,
          key,
          body: bytes,
          contentType: 'application/pdf',
        });
        const publicUrl = `${creds.public_url_base}/${key}`;

        const res = await api.post('/partner/gangsheets', {
          filename: built.filename,
          file_url: publicUrl,
          line_id: linePrefix || '',
          page_format: getGangPageFormat(),
          first_system_id: built.firstSid,
          last_system_id: built.lastSid,
          orders_count: built.ordersInChunk,
          metas_count: built.metasUsed,
          order_ids: built.orderIds,
          meta_ids: built.metaIds,
        });
        out.push(res.data.gangsheet);
      }
      setResults(out);
    } catch (err) {
      const detail = err?.response?.data?.message || err?.message || 'Tạo gangsheet thất bại';
      const status = err?.response?.status ? ` [HTTP ${err.response.status}]` : '';
      console.error('[partner-gangsheet] generate error', err);
      alert(`Tạo gangsheet thất bại${status}:\n${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm space-y-3">
        <div className="flex justify-between items-end gap-3">
          <div>
            <h3 className="text-sm font-semibold text-neutral-700">Đơn được giao ({orders.length})</h3>
            <p className="text-xs text-neutral-500">Các đơn nằm trong gangsheet admin đã chia cho bạn. Gom thành PDF mới để in.</p>
          </div>
          <div className="flex gap-2 items-end">
            <div>
              <label className="text-xs text-neutral-500 block">Đơn / batch</label>
              <div className="mt-1 flex items-center gap-1">
                <input type="number" min="1" value={batchSize}
                  onChange={e => setBatchSize(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-20 px-3 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm" />
                <button type="button"
                  onClick={() => localStorage.setItem('gangsheet_batch_size', String(batchSize))}
                  className="px-2 py-1.5 text-xs rounded-lg bg-neutral-100 hover:bg-neutral-200 text-neutral-700">Lưu</button>
              </div>
            </div>
            <PageFormatSelect />
            <button onClick={handleGenerate} disabled={running || selectedIds.size === 0}
              className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg font-medium">
              {running ? 'Đang tạo…' : `Tạo gang (${selectedIds.size})`}
            </button>
            <button onClick={fetchOrders} className="px-3 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm rounded-lg">Refresh</button>
          </div>
        </div>

        {loading ? (
          <p className="text-neutral-400 text-sm">Loading…</p>
        ) : orders.length === 0 ? (
          <p className="text-neutral-400 text-sm">Chưa có đơn nào được giao cho bạn.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-neutral-500 text-xs border-b border-neutral-200">
                <th className="py-2 text-left w-8"><input type="checkbox" onChange={toggleAll}
                  checked={selectedIds.size === orders.length && orders.length > 0} className="accent-orange-500" /></th>
                <th className="py-2 text-left">System ID</th>
                <th className="py-2 text-left">Ref</th>
                <th className="py-2 text-left">Line</th>
                <th className="py-2 text-right">_qr metas</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(o => {
                const li = o.items?.[0]?.product_variant?.product?.line_id;
                return (
                  <tr key={o.id} className="border-b border-neutral-100 hover:bg-orange-50/40">
                    <td className="py-1.5"><input type="checkbox" checked={selectedIds.has(o.id)} onChange={() => toggle(o.id)} className="accent-orange-500" /></td>
                    <td className="py-1.5 font-mono text-orange-500 text-xs">{o.system_id}</td>
                    <td className="py-1.5 text-xs text-neutral-600">{o.ref_id || '-'}</td>
                    <td className="py-1.5 text-xs text-neutral-600 font-mono">{li || '-'}</td>
                    <td className="py-1.5 text-right text-neutral-700">{countQrMetas(o)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {progress && (
        <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-neutral-700 mb-2">Đang xử lý…</h3>
          <div className="text-xs text-neutral-600">
            Chunk <span className="font-medium">{progress.chunkIndex + 1}/{progress.totalChunks}</span>
            {' · '}meta <span className="font-medium">{progress.done}/{progress.total}</span>
            {progress.system_id && <> · <span className="font-mono text-orange-500">{progress.system_id}</span> / {progress.key}</>}
          </div>
          <div className="mt-2 h-2 bg-neutral-100 rounded overflow-hidden">
            <div className="h-full bg-orange-500 transition-all"
              style={{ width: progress.total ? `${(progress.done / progress.total) * 100}%` : '0%' }} />
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div className="bg-white rounded-xl border border-green-200 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-green-700 mb-2">Vừa tạo</h3>
          <ul className="text-sm space-y-1">
            {results.map(g => (
              <li key={g.id} className="flex justify-between gap-3">
                <span className="font-mono text-neutral-700 truncate">{g.filename}</span>
                <button onClick={() => (window.electronAPI?.openExternal ? window.electronAPI.openExternal(g.file_url) : window.open(g.file_url, '_blank'))}
                  className="text-orange-500 text-xs">Download</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────── Reconvert ───────────────────────────────

// Wipe the _qr metas of the partner's chosen orders so the converter cron
// rebuilds them from the mockup URLs (fixes wrong/blurry designs). Scoped
// server-side to the partner's assigned orders.
function ReconvertTab() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [running, setRunning] = useState(false);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const res = await api.get('/partner/orders');
      setOrders(res.data.orders || []);
      setSelectedIds(new Set());
    } finally { setLoading(false); }
  };
  useEffect(() => { fetchOrders(); }, []);

  const toggle = (id) => setSelectedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => {
    if (selectedIds.size === orders.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(orders.map(o => o.id)));
  };

  const handleReconvert = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Reconvert ${selectedIds.size} đơn?\nCác meta _qr sẽ bị xoá và converter cron build lại từ mockup URL.`)) return;
    setRunning(true);
    try {
      const res = await api.post('/partner/orders/reconvert', { order_ids: [...selectedIds] });
      alert(res?.data?.message || `Reconvert queued cho ${selectedIds.size} đơn`);
      await fetchOrders();
    } catch (err) {
      alert(err?.response?.data?.message || 'Reconvert thất bại');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm space-y-3">
      <div className="flex justify-between items-end gap-3">
        <div>
          <h3 className="text-sm font-semibold text-neutral-700">Reconvert đơn được giao ({orders.length})</h3>
          <p className="text-xs text-neutral-500">Render lại design <span className="font-mono">_qr</span> cho các đơn in lỗi. Cron sẽ build lại tự động.</p>
        </div>
        <div className="flex gap-2 items-end">
          <button onClick={handleReconvert} disabled={running || selectedIds.size === 0}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm rounded-lg font-medium">
            {running ? 'Đang xử lý…' : `Reconvert (${selectedIds.size})`}
          </button>
          <button onClick={fetchOrders} className="px-3 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm rounded-lg">Refresh</button>
        </div>
      </div>

      {loading ? (
        <p className="text-neutral-400 text-sm">Loading…</p>
      ) : orders.length === 0 ? (
        <p className="text-neutral-400 text-sm">Chưa có đơn nào được giao cho bạn.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-neutral-500 text-xs border-b border-neutral-200">
              <th className="py-2 text-left w-8"><input type="checkbox" onChange={toggleAll}
                checked={selectedIds.size === orders.length && orders.length > 0} className="accent-blue-600" /></th>
              <th className="py-2 text-left">System ID</th>
              <th className="py-2 text-left">Ref</th>
              <th className="py-2 text-left">Line</th>
              <th className="py-2 text-right">_qr metas</th>
              <th className="py-2 text-center">Production</th>
            </tr>
          </thead>
          <tbody>
            {orders.map(o => {
              const li = o.items?.[0]?.product_variant?.product?.line_id;
              return (
                <tr key={o.id} className="border-b border-neutral-100 hover:bg-blue-50/40">
                  <td className="py-1.5"><input type="checkbox" checked={selectedIds.has(o.id)} onChange={() => toggle(o.id)} className="accent-blue-600" /></td>
                  <td className="py-1.5 font-mono text-orange-500 text-xs">{o.system_id}</td>
                  <td className="py-1.5 text-xs text-neutral-600">{o.ref_id || '-'}</td>
                  <td className="py-1.5 text-xs text-neutral-600 font-mono">{li || '-'}</td>
                  <td className="py-1.5 text-right text-neutral-700">{countQrMetas(o)}</td>
                  <td className="py-1.5 text-center">
                    {o.production
                      ? <span className="text-xs px-1.5 py-0.5 bg-green-100 text-green-700 rounded">already</span>
                      : <span className="text-xs px-1.5 py-0.5 bg-neutral-100 text-neutral-500 rounded">no</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─────────────────────────────── Manage (assigned list) ───────────────────────────────

// Read-only list of the gangs an admin assigned to this partner (scoped
// server-side). Filter by date / line / page-format + category chips, mark "đã in".
function ManageTab() {
  const [filters, setFilters] = useState({ date_from: '', date_to: '', line_id: '', page_format: '', page: 1 });
  const [list, setList] = useState({ data: [], current_page: 1, last_page: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  // Category sub-tab (client-side, on the current page). 'all' = no filter.
  const [subTab, setSubTab] = useState('all');

  const fetchList = () => {
    setLoading(true);
    const params = { page: filters.page, per_page: 20 };
    if (filters.date_from) params.date_from = filters.date_from;
    if (filters.date_to) params.date_to = filters.date_to;
    if (filters.line_id) params.line_id = filters.line_id;
    if (filters.page_format) params.page_format = filters.page_format;
    api.get('/partner/gangsheets', { params })
      .then(res => { setList(res.data); setSubTab('all'); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { fetchList(); }, [filters.page, filters.page_format]);

  // Category chips + filtered rows (client-side, on the current page).
  const catCounts = {};
  for (const g of list.data) {
    const c = gangCategory(g.filename);
    catCounts[c] = (catCounts[c] || 0) + 1;
  }
  const cats = Object.keys(catCounts).sort((a, b) => catCounts[b] - catCounts[a]);
  const visible = subTab === 'all' ? list.data : list.data.filter(g => gangCategory(g.filename) === subTab);

  const applyFilters = (e) => { e?.preventDefault(); setFilters(f => ({ ...f, page: 1 })); setTimeout(fetchList, 0); };
  const clearFilters = () => { setFilters({ date_from: '', date_to: '', line_id: '', page_format: '', page: 1 }); setTimeout(fetchList, 0); };

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
    <div className="space-y-4">
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

      {/* Size sub-tabs (server-side filter by page_format). */}
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-xs text-neutral-500 mr-1">Khổ:</span>
        <SubChip active={filters.page_format === ''} onClick={() => setFilters(f => ({ ...f, page_format: '', page: 1 }))}>Tất cả</SubChip>
        <SubChip active={filters.page_format === 'original'} onClick={() => setFilters(f => ({ ...f, page_format: 'original', page: 1 }))}>Default (10×7)</SubChip>
        <SubChip active={filters.page_format === 'letter'} onClick={() => setFilters(f => ({ ...f, page_format: 'letter', page: 1 }))}>Letter 11×8.5</SubChip>
      </div>

      {/* Category chips (parsed from filename) — easy to tell batches apart. */}
      {!loading && list.data.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <SubChip active={subTab === 'all'} onClick={() => setSubTab('all')}>All <CountBadge n={list.data.length} /></SubChip>
          {cats.map(c => (
            <SubChip key={c || '_plain'} active={subTab === c} onClick={() => setSubTab(c)}>
              {gangCategoryLabel(c)} <CountBadge n={catCounts[c]} />
            </SubChip>
          ))}
        </div>
      )}

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
              <th className="px-3 py-2 text-left">Creator</th>
              <th className="px-3 py-2 text-left">When</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="p-6 text-center text-neutral-400">Loading…</td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={9} className="p-6 text-center text-neutral-400">Chưa có gangsheet nào được phân quyền.</td></tr>
            ) : visible.map(g => (
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
                <td className="px-3 py-2 text-xs">{g.creator?.name || '-'}</td>
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
