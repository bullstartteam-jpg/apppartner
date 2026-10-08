import { useEffect, useState } from 'react';
import api from '../services/api';
import { notify, askConfirm } from '../components/Dialog';
import ImagePicker from '../components/ImagePicker';
import { driveThumb } from '../utils/drive';
import { createStickerGangs } from './Gangsheet';

// Sticker Sheet summary for the partner: the partner's orders grouped by the
// sheet design they print, so a batch of the same sheet can be pulled and
// ganged together. Designs are analysed and templates ("mẫu") saved by staff in
// bullstart-app; this page reads them.
//
//   Single  orders printing exactly one sheet, one card per design
//   Multi   orders printing 2+ sheets, one row per order (design × sheets),
//           filterable by design

const STATUS_LABEL = { 0: 'New', 1: 'Processing', 2: 'Wrong size', 3: 'Fixed', 4: 'Reprint', 5: 'On hold', 6: 'Shipped', 7: 'Cancelled', 8: 'Resend' };
const OPEN_STATUSES = [0, 1, 2, 3, 4, 5, 8];   // default: not shipped / cancelled

// Ganged state of an order / design: all its _qr on a gang, some, or none.
const gangState = (x) => (!x?.qr_total ? 'none' : x.qr_ganged >= x.qr_total ? 'done' : x.qr_ganged > 0 ? 'part' : 'none');

function GangBadge({ x }) {
  const st = gangState(x);
  if (st === 'done') return <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-semibold whitespace-nowrap">✓ Đã gang</span>;
  if (st === 'part') return <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-semibold whitespace-nowrap">Gang {x.qr_ganged}/{x.qr_total}</span>;
  return <span className="px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-500 text-[10px] whitespace-nowrap">Chưa gang</span>;
}

// Order chip in a group: green once ganged, amber when part-ganged.
const orderChipCls = (o) => ({
  done: 'bg-emerald-50 border-emerald-300 text-emerald-700',
  part: 'bg-amber-50 border-amber-300 text-amber-700',
  none: 'bg-[#faf8f6] border-neutral-200 text-neutral-700',
})[gangState(o)];

const thumb = (url, size = 'w400') => driveThumb(url, size);

const copyIds = async (ids) => {
  try { await navigator.clipboard.writeText(ids.join('\n')); notify(`Đã copy ${ids.length} ID`, { title: 'Copy', kind: 'success' }); }
  catch { notify('Không copy được', { title: 'Copy', kind: 'error' }); }
};

export default function StickerSheets() {
  const [data, setData] = useState(null);
  const [statuses, setStatuses] = useState(() => new Set(OPEN_STATUSES));
  const [mode, setMode] = useState('single');
  const [design, setDesign] = useState('');       // multi: orders containing this design
  const [ganging, setGanging] = useState(null);   // { label, done, total, system_id }
  const [zoom, setZoom] = useState(null);         // design image in the lightbox
  const [hideGanged, setHideGanged] = useState(false);

  const load = (st = statuses, m = mode) => {
    setData(null);
    return api.get('/partner/sticker-sheets/summary', { params: { mode: m, statuses: [...st] } })
      .then(res => setData(res.data))
      .catch(err => {
        setData({ groups: [], unmatched: [], orders: [], design_options: [], not_analysed: [], totals: {}, counts: {} });
        notify(err?.response?.data?.message || 'Không tải được tổng hợp', { title: 'Sticker Sheet', kind: 'error' });
      });
  };
  useEffect(() => { load(); }, []);

  const pickMode = (m) => { setMode(m); setDesign(''); load(statuses, m); };
  const toggleStatus = (k) => {
    const next = new Set(statuses);
    next.has(k) ? next.delete(k) : next.add(k);
    if (next.size === 0) return;
    setStatuses(next);
    load(next);
  };
  const setPreset = (list) => { const next = new Set(list); setStatuses(next); load(next); };

  // Gang the unproduced _qr of these designs: one PNG gang per _qr, tagged
  // with its template and assigned to this partner by the hub.
  const makeGangs = async (analysisIds, label) => {
    if (ganging || !analysisIds?.length) return;
    try {
      setGanging({ label, done: 0, total: 0 });
      const src = (await api.post('/partner/sticker-sheets/gang-source', { analysis_ids: analysisIds })).data;
      const orders = src.orders || [];
      const qrCount = orders.reduce((n, o) => n + o.items.reduce((m, it) => m + it.metas.length, 0), 0);
      const skipNote = src.skipped?.length ? `\n${src.skipped.length} đơn không còn _qr để gang (chưa convert hoặc đã có gang).` : '';
      if (qrCount === 0) {
        setGanging(null);
        notify(`Không có _qr nào để tạo gang.${skipNote}`, { title: 'Tạo gang', kind: 'error' });
        return;
      }
      const ok = await askConfirm(
        `Tạo ${qrCount} gang (mỗi _qr 1 gang, file PNG) cho ${orders.length} đơn — ${label}?${skipNote}`,
        { title: 'Tạo gang Sticker Sheet', okText: `Tạo ${qrCount} gang` },
      );
      if (!ok) { setGanging(null); return; }
      const created = await createStickerGangs(orders, { onProgress: (p) => setGanging({ label, ...p }) });
      notify(`Đã tạo ${created.length} gang — xem ở Gangsheet → Manage.${skipNote}`, { title: 'Tạo gang', kind: 'success' });
      load();
    } catch (err) {
      notify(err?.response?.data?.message || err?.message || 'Tạo gang thất bại', { title: 'Tạo gang', kind: 'error' });
    } finally {
      setGanging(null);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-xl font-bold text-neutral-800">Sticker Sheet</h2>
        <p className="text-xs text-neutral-500 mt-1 max-w-2xl">
          Đơn Sticker Sheet của bạn gom theo mẫu thiết kế. Bấm "Tạo gang" để tạo gang cho cả nhóm — mỗi tờ (_qr) là 1 gang PNG riêng.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-neutral-200 p-3 flex flex-wrap items-center gap-1.5">
        <div className="flex rounded-lg overflow-hidden border border-neutral-200 mr-3">
          {[['single', 'Single (1 tờ)'], ['multi', 'Multi (2+ tờ)']].map(([m, label]) => (
            <button key={m} onClick={() => pickMode(m)}
              className={`px-3 py-1.5 text-sm ${mode === m ? 'bg-neutral-800 text-white' : 'bg-white text-neutral-600 hover:bg-neutral-50'}`}>
              {label}{data?.counts?.[m] != null && <span className="ml-1 opacity-70">({data.counts[m]})</span>}
            </button>
          ))}
        </div>
        <span className="text-xs text-neutral-500 mr-1">Trạng thái đơn:</span>
        {Object.entries(STATUS_LABEL).map(([k, label]) => (
          <button key={k} onClick={() => toggleStatus(Number(k))}
            className={`px-2.5 py-1 text-xs rounded-full border ${statuses.has(Number(k)) ? 'bg-orange-500 border-orange-500 text-white' : 'bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-50'}`}>
            {label}
          </button>
        ))}
        <span className="mx-1 text-neutral-300">|</span>
        <button onClick={() => setPreset(OPEN_STATUSES)} className="px-2 py-1 text-xs text-neutral-600 underline">Đang làm</button>
        <button onClick={() => setPreset(Object.keys(STATUS_LABEL).map(Number))} className="px-2 py-1 text-xs text-neutral-600 underline">Tất cả</button>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-neutral-600 cursor-pointer">
          <input type="checkbox" checked={hideGanged} onChange={e => setHideGanged(e.target.checked)} className="accent-orange-500" />
          Ẩn đơn đã gang
        </label>
      </div>

      {ganging && (
        <div className="px-3 py-2 rounded-lg bg-orange-50 border border-orange-200 text-sm text-orange-800">
          Đang tạo gang · {ganging.label}{ganging.total ? ` · ${ganging.done}/${ganging.total}` : ' · đang lấy đơn…'}
          {ganging.system_id && <span className="font-mono"> · {ganging.system_id}</span>}
        </div>
      )}

      {data === null ? (
        <p className="text-sm text-neutral-400">Đang tổng hợp…</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-3 text-sm">
            <span className="px-3 py-1.5 rounded-lg bg-white border border-neutral-200">
              <b>{data.totals?.orders ?? 0}</b> đơn · <b>{data.totals?.sheets ?? 0}</b> tờ
            </span>
            {data.not_analysed?.length > 0 && (
              <span className="px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-700" title={data.not_analysed.join(', ')}>
                {data.not_analysed.length} đơn chưa được phân tích mẫu
              </span>
            )}
          </div>

          {mode === 'single' && (
            <div className="space-y-2">
              {[...data.groups, ...data.unmatched].map(g => (
                <SingleCard key={g.key} g={g} onZoom={setZoom} hideGanged={hideGanged}
                  action={<GangButton busy={!!ganging} onClick={() => makeGangs(g.analysis_ids, g.label)} />} />
              ))}
              {data.groups.length + data.unmatched.length === 0 && <Empty />}
            </div>
          )}

          {mode === 'multi' && (
            <MultiOrders orders={(data.orders || []).filter(o => !hideGanged || gangState(o) !== 'done')} options={data.design_options || []}
              design={design} onDesign={setDesign} onZoom={setZoom} onGang={makeGangs} busy={!!ganging} />
          )}
        </>
      )}

      {zoom && (
        <div onClick={() => setZoom(null)} className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
          <img src={thumb(zoom, 'w1600')} alt="" className="max-h-[90vh] max-w-[90vw] bg-white rounded" />
        </div>
      )}
    </div>
  );
}

function Empty() {
  return <p className="text-sm text-neutral-500">Không có đơn Sticker Sheet nào ở các trạng thái đang chọn.</p>;
}

function GangButton({ onClick, busy }) {
  return (
    <button onClick={onClick} disabled={busy}
      className="px-3 py-1 text-xs rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white"
      title="Mỗi _qr chưa gang thành 1 gang PNG riêng">Tạo gang</button>
  );
}

function DesignLabel({ g, small = false }) {
  const cls = small ? 'text-xs' : 'text-sm';
  return g.template
    ? <span className={`px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 font-semibold ${cls}`}>{g.label}</span>
    : <span className={`px-2 py-0.5 rounded bg-neutral-100 text-neutral-600 ${cls}`}>{g.label}</span>;
}

// A group's IDs in two labelled rows — still to gang, then already ganged.
function OrderChipRows({ orders }) {
  const todo = orders.filter(o => gangState(o) !== 'done');
  const done = orders.filter(o => gangState(o) === 'done');
  const chip = (o) => (
    <span key={o.order_id} className={`px-1.5 py-0.5 rounded border text-[11px] font-mono ${orderChipCls(o)}`}
      title={`${STATUS_LABEL[o.status] || ''}${gangState(o) === 'part' ? ` · gang ${o.qr_ganged}/${o.qr_total}` : ''}`}>
      {gangState(o) === 'done' && '✓ '}{o.system_id}
    </span>
  );
  const row = (label, cls, list) => list.length > 0 && (
    <div className="flex gap-2">
      <span className={`shrink-0 w-24 text-[11px] font-semibold pt-0.5 ${cls}`}>{label} ({list.length})</span>
      <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">{list.map(chip)}</div>
    </div>
  );
  return (
    <div className="space-y-1.5">
      {row('Chưa gang', 'text-neutral-600', todo)}
      {row('✓ Đã gang', 'text-emerald-700', done)}
      {orders.length === 0 && <span className="text-xs text-neutral-400">Đã gang hết.</span>}
    </div>
  );
}

function SingleCard({ g, onZoom, action, hideGanged }) {
  const orders = hideGanged ? g.orders.filter(o => gangState(o) !== 'done') : g.orders;
  const ids = orders.map(o => o.system_id).filter(Boolean);
  return (
    <div className="bg-white rounded-xl border border-neutral-200 p-3 flex gap-4">
      <button type="button" onClick={() => onZoom(g.sample_url)} className="shrink-0" title="Xem thiết kế">
        <img src={thumb(g.sample_url)} alt="" loading="lazy" className="h-48 w-32 object-contain bg-neutral-100 rounded" />
      </button>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <DesignLabel g={g} />
          <span className="text-sm text-neutral-700"><b>{g.orders_count}</b> đơn · <b>{g.sheets}</b> tờ · {g.sticker_count} sticker/tờ</span>
          {g.orders_ganged != null && (
            <span className={`text-xs ${g.orders_ganged >= g.orders_count ? 'text-emerald-700' : 'text-neutral-500'}`}>
              ✓ {g.orders_ganged}/{g.orders_count} đơn đã gang
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {action}
            <button onClick={() => copyIds(ids)} className="px-3 py-1 text-xs rounded-lg border border-neutral-200 hover:bg-neutral-50">Copy ID ({ids.length})</button>
          </div>
        </div>
        {g.template?.note && <div className="text-[11px] text-neutral-500">{g.template.note}</div>}
        <OrderChipRows orders={orders} />
      </div>
    </div>
  );
}

function MultiOrders({ orders, options, design, onDesign, onZoom, onGang, busy }) {
  const shown = design ? orders.filter(o => o.parts.some(p => p.key === design)) : orders;
  const ids = shown.map(o => o.system_id).filter(Boolean);
  // With a design picked, gang only that design's sheets of these orders.
  const gangIds = shown.flatMap(o => o.parts.filter(p => !design || p.key === design).flatMap(p => p.analysis_ids || []));
  const designLabel = design ? (options.find(o => o.key === design)?.label || '') : 'tất cả mẫu';

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border border-neutral-200 p-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs text-neutral-500 block">Mẫu thiết kế</label>
          <ImagePicker value={design} onChange={onDesign} allLabel={`Tất cả (${orders.length} đơn)`}
            options={options.map(o => ({ value: o.key, label: o.label, image: o.sample_url, sub: `${o.orders} đơn · ${o.sheets} tờ` }))} />
        </div>
        <span className="text-sm text-neutral-600"><b>{shown.length}</b> đơn · <b>{shown.reduce((n, o) => n + o.sheets, 0)}</b> tờ</span>
        <div className="ml-auto flex gap-2">
          <button onClick={() => copyIds(ids)} disabled={!ids.length}
            className="px-3 py-1.5 text-xs rounded-lg border border-neutral-200 hover:bg-neutral-50 disabled:opacity-40">Copy ID ({ids.length})</button>
          <button onClick={() => onGang(gangIds, `multi · ${designLabel}`)} disabled={busy || !gangIds.length}
            className="px-3 py-1.5 text-xs rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white">
            Tạo gang ({shown.length} đơn)
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-neutral-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-neutral-500 bg-[#faf8f6]">
            <tr>
              <th className="px-3 py-2 text-left">Đơn</th>
              <th className="px-3 py-2 text-left">Trạng thái</th>
              <th className="px-3 py-2 text-right">Tờ</th>
              <th className="px-3 py-2 text-left">Gang</th>
              <th className="px-3 py-2 text-left">Mẫu trong đơn</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {shown.length === 0 ? (
              <tr><td colSpan={5} className="p-6 text-center text-neutral-400">Không có đơn.</td></tr>
            ) : shown.map(o => (
              <tr key={o.order_id} className="align-top">
                <td className="px-3 py-2 font-mono text-xs text-orange-600 whitespace-nowrap">{o.system_id}</td>
                <td className="px-3 py-2 text-xs text-neutral-600 whitespace-nowrap">{STATUS_LABEL[o.status] || o.status}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{o.sheets}</td>
                <td className="px-3 py-2"><GangBadge x={o} /></td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-2">
                    {o.parts.map(p => (
                      <button key={p.key} type="button" onClick={() => onZoom(p.sample_url)}
                        className={`flex gap-2 items-center p-1.5 rounded-lg border text-left hover:bg-orange-50/40 ${design === p.key ? 'border-orange-400 bg-orange-50' : 'border-neutral-200'}`}>
                        <img src={thumb(p.sample_url, 'w120')} alt="" loading="lazy" className="h-14 w-10 object-contain bg-neutral-100 rounded" />
                        <div>
                          <DesignLabel g={p} small />
                          <div className="text-xs text-orange-600 font-semibold mt-0.5">× {p.qty} tờ</div>
                          <div className="text-[10px] text-neutral-400">{p.sticker_count} sticker/tờ</div>
                          <div className="mt-0.5"><GangBadge x={p} /></div>
                        </div>
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
