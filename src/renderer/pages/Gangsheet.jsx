import { useEffect, useState } from 'react';
import api from '../services/api';
import {
  buildGangsheetForChunk, buildTiledGangsheet, chunkArray, flattenQrMetas, isQrKey,
  getGangPageFormat, setGangPageFormat,
  rasterizeGangPdf, fetchFileBytes,
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

// ─────────────────────────────── helpers ───────────────────────────────

function orderMetaCount(order, includeProduced = false) {
  let n = 0;
  for (const it of order.items || [])
    for (const m of it.metas || [])
      if (isQrKey(m.key) && (includeProduced || !m.production)) n++;
  return n;
}

function chunkCardOrders(orders, perPage = 3, includeProduced = false) {
  if (orders.length === 0) return [];
  const chunks = [];
  let cur = [];
  let metas = 0;
  for (const o of orders) {
    const n = orderMetaCount(o, includeProduced);
    cur.push(o);
    metas += n;
    if (metas > 0 && metas % perPage === 0) {
      chunks.push(cur);
      cur = [];
      metas = 0;
    }
  }
  // Leftovers are ALWAYS folded into the previous chunk, however many. A group
  // whose total is not a multiple of perPage has to end on a partial page —
  // that is arithmetic — but it should be exactly one, at the end of the last
  // gang. Giving the leftovers their own chunk (the old `metas < perPage` rule)
  // produced a separate gang whose last page carried 1-2 designs, which is the
  // orphan page this function exists to prevent.
  if (cur.length > 0) {
    if (chunks.length > 0) {
      chunks[chunks.length - 1] = chunks[chunks.length - 1].concat(cur);
    } else {
      chunks.push(cur);   // whole group is smaller than one page
    }
  }
  return chunks;
}

function slugifyAccessory(name) {
  return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
}

function orderMaterial(order) {
  for (const it of order.items || []) {
    const id = it.material_id ?? it.material?.id;
    if (id) return { id, name: it.material?.name || '' };
  }
  return { id: 0, name: '' };
}

function orderSideCount(order, includeProduced = false) {
  let hasFront = false, hasBack = false;
  for (const it of order.items || []) {
    for (const m of it.metas || []) {
      if (m.production && !includeProduced) continue;
      if (m.key === 'front_qr' || /^front_qr(_\d+)?$/.test(m.key)) hasFront = true;
      if (m.key === 'back_qr'  || /^back_qr(_\d+)?$/.test(m.key))  hasBack  = true;
      if (hasFront && hasBack) return 'two';
    }
  }
  return hasFront || hasBack ? 'one' : 'none';
}

function orderSplitAccessory(order) {
  let id = 0, name = '';
  const consider = (acc) => {
    if (!acc?.id || acc.gangsheet_split === false) return;
    if (id === 0 || acc.id < id) { id = acc.id; name = acc.name || ''; }
  };
  for (const it of order.items || []) {
    for (const ap of it.accessory_prices || []) consider(ap.accessory);
    consider(it.accessory_price?.accessory);
  }
  return { id, name };
}

function orderProduct(order) {
  const counts = {}, names = {};
  for (const it of order.items || []) {
    const pid = it.product_variant?.product_id ?? it.product_variant?.product?.id;
    if (!pid) continue;
    counts[pid] = (counts[pid] || 0) + 1;
    names[pid] = it.product_variant?.product?.name || '';
  }
  let best = 0, max = -1;
  for (const [pid, c] of Object.entries(counts)) if (c > max) { max = c; best = Number(pid); }
  return { id: best, name: names[best] || '' };
}

function orderOrderType(order) {
  const counts = {};
  for (const it of order.items || []) {
    const ot = it.product_variant?.product?.order_type;
    if (ot) counts[ot] = (counts[ot] || 0) + 1;
  }
  let best = '', max = -1;
  for (const [ot, c] of Object.entries(counts)) if (c > max) { max = c; best = ot; }
  return best;
}

function orderConvertLayout(order, layoutMap) {
  const ot = orderOrderType(order);
  return (ot && layoutMap?.[ot]) || 'default';
}

const NATIVE_SIZES = new Set(['5x5']);
function normSize(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, '').replace(/×/g, 'x');
}
function orderIsNative(order) {
  for (const it of order.items || []) {
    const sz = normSize(it.product_variant?.size);
    if (sz && NATIVE_SIZES.has(sz)) return true;
  }
  return false;
}

// --- Chip add-on (card skin gang split) ---
function chipKindOf(text) {
  const s = String(text || '').toLowerCase();
  if (/holo/.test(s) || /\bhlg[a-z]*\b/.test(s)) return 'holo';
  if (/small/.test(s) || /\bsmc\b/.test(s)) return 'smallchip';
  if (/big/.test(s) || /\bbc\b/.test(s)) return 'bigchip';
  return '';
}

function itemAccessoryList(item) {
  const out = [];
  const push = (ap) => {
    if (!ap) return;
    const name = ap.accessory?.name || '';
    const style = ap.style || '';
    const code = ap.accessory_code || '';
    if (!name && !style && !code) return;
    const key = `${name}|${style}|${code}`;
    if (out.some(o => o.key === key)) return;
    out.push({ key, name, style, code });
  };
  for (const ap of item.accessory_prices || []) push(ap);
  push(item.accessory_price);
  return out;
}

function orderChipTag(order) {
  for (const it of order.items || []) {
    for (const a of itemAccessoryList(it)) {
      const kind = chipKindOf(a.style) || chipKindOf(a.code) || chipKindOf(a.name);
      if (kind === 'holo') return 'holo';
      if (kind === 'bigchip' || kind === 'smallchip') return 'chip';
    }
  }
  return 'nochip';
}

// --- Classification dimensions ---
const GANG_DIMS = [
  { id: 'product',  label: 'Product' },
  { id: 'addon',    label: 'Add-on' },
  { id: 'material', label: 'Material' },
];
const DEFAULT_GROUP_BY = ['addon', 'material'];

function loadGroupBy() {
  try {
    const v = JSON.parse(localStorage.getItem('gangsheet_group_by'));
    if (Array.isArray(v)) return new Set(v.filter(x => GANG_DIMS.some(d => d.id === x)));
  } catch { /* ignore */ }
  return new Set(DEFAULT_GROUP_BY);
}
function saveGroupBy(set) {
  try { localStorage.setItem('gangsheet_group_by', JSON.stringify([...set])); } catch { /* ignore */ }
}

function orderBucketInfo(order, groupBy = new Set(DEFAULT_GROUP_BY), includeProduced = false) {
  const side = orderSideCount(order, includeProduced) === 'two' ? 'two' : 'one';
  const keyParts = [side];
  const labelParts = [side === 'two' ? '2 sides' : '1 side'];
  const tagParts = [];
  const info = { side, prod: { id: 0 }, acc: { id: 0 }, mat: { id: 0 } };

  if (groupBy.has('product')) {
    const p = orderProduct(order); info.prod = p;
    keyParts.push(`p${p.id}`);
    labelParts.push(p.id ? (p.name || `SP#${p.id}`) : 'No product');
    if (p.id) tagParts.push(slugifyAccessory(p.name));
  }
  if (groupBy.has('addon')) {
    const a = orderSplitAccessory(order); info.acc = a;
    keyParts.push(`a${a.id}`);
    labelParts.push(a.id ? (a.name || `Acc#${a.id}`) : 'No add-on');
    if (a.id) tagParts.push(slugifyAccessory(a.name));
  }
  if (groupBy.has('material')) {
    const m = orderMaterial(order); info.mat = m;
    keyParts.push(`m${m.id}`);
    labelParts.push(m.id ? (m.name || `Mat#${m.id}`) : 'No material');
    if (m.id) tagParts.push(slugifyAccessory(m.name));
  }
  if (side === 'two') tagParts.push('two_size');

  return {
    ...info, side,
    key: keyParts.join('|'),
    label: labelParts.join(' · '),
    tag: tagParts.filter(Boolean).join('_'),
  };
}

// --- Shared gang routing ---
function routeOrdersToChunks(orders, { layoutMap, groupBy, batchSize, includeProduced = false } = {}) {
  const cardOrders = [];
  const nativeOrders = [];
  const normalOrders = [];
  for (const o of orders) {
    if (orderConvertLayout(o, layoutMap) === 'outside') cardOrders.push(o);
    else if (orderIsNative(o)) nativeOrders.push(o);
    else normalOrders.push(o);
  }

  const chunks = [];

  // Native (e.g. 5x5): merged gang keeping each design's own size.
  const nativeGroups = new Map();
  for (const o of nativeOrders) {
    let sz = '';
    for (const it of o.items || []) {
      const s = normSize(it.product_variant?.size);
      if (s && NATIVE_SIZES.has(s)) { sz = s; break; }
    }
    if (!nativeGroups.has(sz)) nativeGroups.set(sz, []);
    nativeGroups.get(sz).push(o);
  }
  for (const [sz, ords] of nativeGroups) {
    for (const chunk of chunkArray(ords, batchSize)) {
      chunks.push({ chunk, suffix: sz || 'native', tiled: false, native: true });
    }
  }

  // Normal: group by the chosen dimensions (+ side), chunk by batchSize.
  const bucketGroups = new Map();
  for (const o of normalOrders) {
    const b = orderBucketInfo(o, groupBy, includeProduced);
    if (!bucketGroups.has(b.key)) bucketGroups.set(b.key, { tag: b.tag, orders: [] });
    bucketGroups.get(b.key).orders.push(o);
  }
  for (const [, g] of bucketGroups) {
    for (const chunk of chunkArray(g.orders, batchSize)) {
      chunks.push({ chunk, suffix: g.tag, tiled: false });
    }
  }

  // Card skin: gom theo order_type × chip, 3 orders/chunk.
  const cardGroups = new Map();
  for (const o of cardOrders) {
    const ot = orderOrderType(o) || 'skincard';
    const chip = orderChipTag(o);
    const key = `${ot}||${chip}`;
    if (!cardGroups.has(key)) cardGroups.set(key, { ot, chip, orders: [] });
    cardGroups.get(key).orders.push(o);
  }
  for (const [, g] of cardGroups) {
    const tag = `${slugifyAccessory(g.ot) || 'skincard'}_${g.chip}`;
    for (const chunk of chunkCardOrders(g.orders, 3, includeProduced)) {
      chunks.push({ chunk, suffix: tag, tiled: true });
    }
  }

  return chunks;
}

function chunkPageFormat({ tiled, native }) {
  return tiled ? 'letter_6up' : (native ? 'native' : getGangPageFormat());
}

function buildChunkPdf({ chunk, suffix, tiled, native }, { linePrefix, seq, includeProduced = false, collectPages = false, onProgress } = {}) {
  const opts = { linePrefix, nameSuffix: suffix, seq, includeProduced, collectPages, onProgress };
  return tiled
    ? buildTiledGangsheet(chunk, opts)
    : buildGangsheetForChunk(chunk, { ...opts, pageFormat: chunkPageFormat({ tiled, native }) });
}

// --- PNG export ---

function pngNameForPage(pdfFilename, pageIndex) {
  const base = String(pdfFilename || 'gangsheet').replace(/\.pdf$/i, '');
  return `${base}_p${String(pageIndex + 1).padStart(2, '0')}.png`;
}

async function uploadGangPngs(pageBlobs, { creds, pdfFilename, onProgress }) {
  const urls = [];
  for (let i = 0; i < pageBlobs.length; i++) {
    const name = pngNameForPage(pdfFilename, i);
    const key = `${creds.folder}/${name}`;
    const bytes = new Uint8Array(await pageBlobs[i].arrayBuffer());
    await window.electronAPI.s3Upload({
      credentials: creds,
      bucket: creds.bucket,
      key,
      body: bytes,
      contentType: 'image/png',
    });
    urls.push(`${creds.public_url_base}/${key}`);
    onProgress?.({ pngDone: i + 1, pngTotal: pageBlobs.length });
  }
  return urls;
}

/**
 * Upload a built chunk's PDF(s) to B2 and return their public URLs in page
 * order. Card-skin gangs arrive as one file per page (built.pdfPages); every
 * other branch still produces a single multi-page file.
 */
async function uploadGangPdfs(built, creds) {
  const files = built.pdfPages?.length
    ? built.pdfPages
    : [{ blob: built.blob, filename: built.filename }];
  const urls = [];
  for (const f of files) {
    const key = `${creds.folder}/${f.filename}`;
    const bytes = new Uint8Array(await f.blob.arrayBuffer());
    await window.electronAPI.s3Upload({
      credentials: creds, bucket: creds.bucket, key, body: bytes,
      contentType: 'application/pdf',
    });
    urls.push(`${creds.public_url_base}/${key}`);
  }
  return urls;
}

function openGangPngs(g) {
  for (const url of g?.png_urls || []) {
    if (window.electronAPI?.openExternal) window.electronAPI.openExternal(url);
    else window.open(url, '_blank');
  }
}

function loadExportPng() {
  try { return localStorage.getItem('gangsheet_export_png') === '1'; } catch { return false; }
}
function saveExportPng(v) {
  try { localStorage.setItem('gangsheet_export_png', v ? '1' : '0'); } catch { /* noop */ }
}

// --- Product filters ---
const PF_KEYS = [
  'product_id', 'line_id', 'product_variant_id', 'sku', 'color', 'size',
  'paper_type', 'material_id', 'accessory_id', 'accessory_code',
];
const PF_DEFAULTS = Object.fromEntries(PF_KEYS.map(k => [k, '']));
const hasActivePf = (pf) => PF_KEYS.some(k => pf[k]);

function uniqueSorted(values) {
  return [...new Set(values.filter(v => v != null && String(v).trim() !== ''))]
    .sort((a, b) => String(a).localeCompare(String(b)));
}

function itemAccessoryIds(item) {
  const ids = new Set();
  for (const ap of item.accessory_prices || []) {
    const id = ap.accessory_id ?? ap.accessory?.id;
    if (id) ids.add(String(id));
  }
  const legacy = item.accessory_price?.accessory_id ?? item.accessory_price?.accessory?.id;
  if (legacy) ids.add(String(legacy));
  return ids;
}

function itemAccessoryCodes(item) {
  const codes = new Set();
  for (const ap of item.accessory_prices || []) {
    if (ap.accessory_code) codes.add(String(ap.accessory_code).trim().toUpperCase());
  }
  const legacy = item.accessory_price?.accessory_code;
  if (legacy) codes.add(String(legacy).trim().toUpperCase());
  return codes;
}

function orderMatchesProductFilters(order, pf) {
  if (!hasActivePf(pf)) return true;
  const items = order.items || [];
  const some = (fn) => items.some(fn);
  const eq = (a, b) => a != null && String(a) === String(b);

  if (pf.product_id && !some(it => eq(it.product_variant?.product_id ?? it.product_variant?.product?.id, pf.product_id))) return false;
  if (pf.line_id && !some(it => eq(it.product_variant?.product?.line_id, pf.line_id))) return false;
  if (pf.product_variant_id && !some(it => eq(it.product_variant_id ?? it.product_variant?.id, pf.product_variant_id))) return false;
  if (pf.sku && !some(it => eq(it.product_variant?.sku, pf.sku))) return false;
  for (const f of ['color', 'size', 'paper_type']) {
    if (pf[f] && !some(it => eq(it.product_variant?.[f], pf[f]))) return false;
  }
  if (pf.material_id && !some(it => eq(it.material_id ?? it.material?.id, pf.material_id))) return false;
  if (pf.accessory_id && !some(it => itemAccessoryIds(it).has(String(pf.accessory_id)))) return false;
  if (pf.accessory_code) {
    const code = String(pf.accessory_code).trim().toUpperCase();
    if (!some(it => itemAccessoryCodes(it).has(code))) return false;
  }
  return true;
}

// --- Misc helpers ---

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

function countQrMetas(order) {
  let n = 0;
  for (const it of order.items || []) for (const m of it.metas || [])
    if (isQrKey(m.key)) n++;
  return n;
}

// Category of a gangsheet, parsed from filename tail after date token.
function gangCategory(filename) {
  const m = String(filename || '').match(/_[A-Za-z]{3}\d{2}_(.+)\.pdf$/i);
  return m ? m[1] : '';
}
const gangCategoryLabel = (cat) => cat ? cat.replace(/_/g, ' · ') : 'Other';

function PageFormatSelect() {
  const [fmt, setFmt] = useState(getGangPageFormat());
  return (
    <div>
      <label className="text-xs text-neutral-500 block">Page format</label>
      <select
        value={fmt}
        onChange={e => { setFmt(e.target.value); setGangPageFormat(e.target.value); }}
        className="mt-1 px-3 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm"
      >
        <option value="original">Default (10×7)</option>
        <option value="letter">Letter 11×8.5</option>
      </select>
    </div>
  );
}

function loadDefaultBatch() {
  const v = parseInt(localStorage.getItem('gangsheet_batch_size'), 10);
  return v > 0 ? v : 10;
}

// ─────────────────────────────── page shell ───────────────────────────────

export default function Gangsheet() {
  const [tab, setTab] = useState('compose');
  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-xl font-bold text-neutral-800">Gangsheet</h2>
        <p className="text-xs text-neutral-500 mt-1">Create / reprint gangsheets from your assigned orders.</p>
      </div>

      <div className="flex gap-2 border-b border-neutral-200">
        <TabBtn active={tab === 'compose'} onClick={() => setTab('compose')}>Compose</TabBtn>
        <TabBtn active={tab === 'find'} onClick={() => setTab('find')}>Find / Re-gang</TabBtn>
        <TabBtn active={tab === 'reconvert'} onClick={() => setTab('reconvert')}>Reconvert</TabBtn>
        <TabBtn active={tab === 'manage'} onClick={() => setTab('manage')}>Manage</TabBtn>
      </div>

      {tab === 'compose' && <ComposeTab />}
      {tab === 'find' && <FindTab />}
      {tab === 'reconvert' && <ReconvertTab />}
      {tab === 'manage' && <ManageTab />}
    </div>
  );
}

// ─────────────────────────────── Compose ───────────────────────────────

function ComposeTab() {
  const [orders, setOrders] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [batchSize, setBatchSize] = useState(loadDefaultBatch);
  const [batchSaved, setBatchSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState([]);
  // Sub-tab filter: 'all' | a bucket key.
  const [subTab, setSubTab] = useState('all');
  // Export PNG per page alongside the PDF.
  const [exportPng, setExportPng] = useState(loadExportPng);
  // Classification dimensions (multi-select).
  const [groupBy, setGroupBy] = useState(loadGroupBy);
  const toggleGroupBy = (dim) => setGroupBy(prev => {
    const next = new Set(prev);
    next.has(dim) ? next.delete(dim) : next.add(dim);
    saveGroupBy(next);
    setSubTab('all');
    return next;
  });
  // Product filters (client-side).
  const [pf, setPf] = useState(PF_DEFAULTS);
  const [catalogProducts, setCatalogProducts] = useState([]);
  const [catalogVariants, setCatalogVariants] = useState([]);
  const [catalogMaterials, setCatalogMaterials] = useState([]);
  const [catalogAccessories, setCatalogAccessories] = useState([]);
  const patchPf = (patch) => { setPf(p => ({ ...p, ...patch })); setSubTab('all'); };
  // No partner picker here: /gangsheets/partner-users and
  // PUT /gangsheets/{id}/partners are admin/support only, so for a partner
  // account they answered 403 and the picker never rendered. The gang is
  // assigned server-side to whoever created it — see storeGangsheet.
  // order_type → convert layout map.
  const [layoutMap, setLayoutMap] = useState({});

  useEffect(() => {
    api.get('/settings/convert-layouts')
      .then(res => setLayoutMap(res.data?.map || {}))
      .catch(() => {});
    api.get('/products', { params: { status: 1, per_page: 100 } })
      .then(res => setCatalogProducts(res.data?.data || []))
      .catch(() => {});
  }, []);

  // Variant / material / accessory options for selected product.
  useEffect(() => {
    const pid = pf.product_id;
    if (!pid) {
      setCatalogVariants([]); setCatalogMaterials([]); setCatalogAccessories([]);
      return;
    }
    Promise.all([
      api.get('/variants', { params: { product_id: pid, status: 1 } }),
      api.get(`/products/${pid}/materials`),
      api.get('/accessories', { params: { product_id: pid } }),
    ]).then(([vRes, mRes, aRes]) => {
      const variants = vRes.data?.data ?? vRes.data ?? [];
      setCatalogVariants(Array.isArray(variants) ? variants : []);
      setCatalogMaterials(Array.isArray(mRes.data) ? mRes.data : (mRes.data?.data || []));
      setCatalogAccessories(Array.isArray(aRes.data) ? aRes.data : (aRes.data?.data || []));
    }).catch(() => {
      setCatalogVariants([]); setCatalogMaterials([]); setCatalogAccessories([]);
    });
  }, [pf.product_id]);

  const catalogLineIds = uniqueSorted(catalogProducts.map(p => p.line_id));
  const catalogColors = uniqueSorted(catalogVariants.map(v => v.color));
  const catalogSizes = uniqueSorted(catalogVariants.map(v => v.size));
  const catalogPaperTypes = uniqueSorted(catalogVariants.map(v => v.paper_type));
  const catalogSkus = uniqueSorted(catalogVariants.map(v => v.sku));
  const selectedAccessory = pf.accessory_id
    ? catalogAccessories.find(a => String(a.id) === String(pf.accessory_id))
    : null;
  const catalogAccessoryCodes = uniqueSorted(
    (selectedAccessory?.prices ?? []).map(p => p.accessory_code).filter(Boolean)
  );

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

  // Buckets built from visible (product-filtered) orders.
  const visibleOrders = hasActivePf(pf) ? orders.filter(o => orderMatchesProductFilters(o, pf)) : orders;

  const buckets = (() => {
    const map = new Map();
    for (const o of visibleOrders) {
      const b = orderBucketInfo(o, groupBy, true);
      if (!map.has(b.key)) map.set(b.key, { label: b.label, side: b.side, tag: b.tag, orders: [] });
      map.get(b.key).orders.push(o);
    }
    return map;
  })();
  const bucketList = [...buckets.entries()]
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => (a.side === b.side ? b.orders.length - a.orders.length : (a.side === 'one' ? -1 : 1)));

  const filteredOrders = subTab === 'all' ? visibleOrders : (buckets.get(subTab)?.orders || []);

  const toggleAll = () => {
    const visibleIds = new Set(filteredOrders.map(o => o.id));
    const allSelected = filteredOrders.length > 0 && filteredOrders.every(o => selectedIds.has(o.id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) visibleIds.forEach(id => next.delete(id));
      else visibleIds.forEach(id => next.add(id));
      return next;
    });
  };

  const countItemQrMetas = (item) =>
    (item.metas || []).filter(m => isQrKey(m.key)).length;

  const handleGenerate = async () => {
    const selected = orders.filter(o => selectedIds.has(o.id));
    if (selected.length === 0) { alert('Select at least 1 order'); return; }
    if (!window.electronAPI?.s3Upload) {
      alert('Gangsheet creation requires the desktop app (Electron).');
      return;
    }

    // Route + chunk with the same 3-branch flow as bullstart-app.
    const chunks = routeOrdersToChunks(selected, { layoutMap, groupBy, batchSize, includeProduced: true });

    setRunning(true); setResults([]);
    const out = [];
    try {
      const credsRes = await api.get('/partner/storage-credentials');
      const creds = credsRes.data;

      for (let ci = 0; ci < chunks.length; ci++) {
        const { chunk } = chunks[ci];
        const linePrefix = dominantLineId(chunk);
        const totalInChunk = flattenQrMetas(chunk, { includeProduced: true }).length;
        setProgress({ chunkIndex: ci, totalChunks: chunks.length, done: 0, total: totalInChunk, system_id: '', key: '' });

        const pageFormat = chunkPageFormat(chunks[ci]);
        const built = await buildChunkPdf(chunks[ci], {
          linePrefix, seq: ci + 1, includeProduced: true, collectPages: exportPng,
          onProgress: (p) => setProgress(prev => ({ ...prev, ...p })),
        });

        // 0) PNG export (when ticked): upload each page as a separate .png.
        //    Named off baseFilename — built.filename is now page 1's name.
        let pngUrls = null;
        if (exportPng && built.pageBlobs?.length) {
          pngUrls = await uploadGangPngs(built.pageBlobs, {
            creds, pdfFilename: built.baseFilename || built.filename,
            onProgress: (p) => setProgress(prev => ({ ...prev, ...p })),
          });
        }

        // 1) Upload the PDFs to B2 — card-skin gangs come back as one file per
        //    page; other branches still return a single multi-page file.
        const pdfUrls = await uploadGangPdfs(built, creds);
        const publicUrl = pdfUrls[0];

        // 2) Record on hub (auto-assigned back to this partner).
        const res = await api.post('/partner/gangsheets', {
          filename: built.filename,
          file_url: publicUrl,
          png_urls: pngUrls,
          pdf_urls: pdfUrls.length > 1 ? pdfUrls : null,
          line_id: linePrefix || '',
          page_format: pageFormat,
          first_system_id: built.firstSid,
          last_system_id: built.lastSid,
          orders_count: built.ordersInChunk,
          metas_count: built.metasUsed,
          order_ids: built.orderIds,
          meta_ids: built.metaIds,
        });
        // storeGangsheet already attached the gang to this partner.
        out.push(res.data.gangsheet);
      }
      setResults(out);
      setSelectedIds(new Set());
      await fetchOrders();
    } catch (err) {
      const detail = err?.response?.data?.message || err?.message || 'Gangsheet creation failed';
      const status = err?.response?.status ? ` [HTTP ${err.response.status}]` : '';
      console.error('[partner-gangsheet] generate error', err);
      alert(`Gangsheet creation failed${status}:\n${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
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
            <h3 className="text-sm font-semibold text-neutral-700">
              Assigned orders ({visibleOrders.length}{hasActivePf(pf) ? ` / ${orders.length}` : ''})
            </h3>
            <p className="text-xs text-neutral-500">Orders from gangsheets assigned to you. Select and compose into new PDFs for printing.</p>
          </div>
          <div className="flex gap-2 items-end">
            <div>
              <label className="text-xs text-neutral-500 block">Orders / batch</label>
              <div className="mt-1 flex items-center gap-1">
                <input type="number" min="1" value={batchSize}
                  onChange={e => { setBatchSize(Math.max(1, parseInt(e.target.value) || 1)); setBatchSaved(false); }}
                  className="w-20 px-3 py-1.5 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm" />
                <button type="button"
                  onClick={() => { localStorage.setItem('gangsheet_batch_size', String(batchSize)); setBatchSaved(true); }}
                  className="px-2 py-1.5 text-xs rounded-lg bg-neutral-100 hover:bg-neutral-200 text-neutral-700">
                  {batchSaved ? '✓ Saved' : 'Save'}
                </button>
              </div>
            </div>
            <PageFormatSelect />
            <label className="flex items-center gap-1.5 text-xs text-neutral-600 cursor-pointer select-none pb-2" title="Also export each page as a separate .png to B2">
              <input type="checkbox" checked={exportPng}
                onChange={e => { setExportPng(e.target.checked); saveExportPng(e.target.checked); }}
                className="accent-orange-500" />
              Export PNG
            </label>
            <button onClick={handleGenerate} disabled={running || selectedIds.size === 0}
              className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg font-medium">
              {running ? 'Generating…' : `Generate (${selectedIds.size})`}
            </button>
            <button onClick={fetchOrders} className="px-3 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm rounded-lg">Refresh</button>
          </div>
        </div>

        {/* Classification dimension toggles */}
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs text-neutral-500 mr-1">Group by:</span>
          {GANG_DIMS.map(d => (
            <SubChip key={d.id} active={groupBy.has(d.id)} onClick={() => toggleGroupBy(d.id)}>{d.label}</SubChip>
          ))}
          <span className="text-[11px] text-neutral-400 ml-1">· 1/2 sides always split</span>
        </div>

        {/* Product filters */}
        <div className="flex flex-wrap items-center gap-2 bg-[#faf8f6]/60 border border-neutral-200 rounded-xl px-3 py-2">
          <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide shrink-0">Product</span>

          <select value={pf.product_id}
            onChange={e => {
              const product_id = e.target.value;
              const product = catalogProducts.find(p => String(p.id) === product_id);
              patchPf({
                product_id,
                line_id: product?.line_id || (product_id ? pf.line_id : ''),
                product_variant_id: '', sku: '', color: '', size: '', paper_type: '',
                material_id: '', accessory_id: '', accessory_code: '',
              });
            }}
            className="px-2 py-1.5 bg-white border border-neutral-200 rounded-lg text-neutral-700 text-sm focus:outline-none max-w-[200px]"
          >
            <option value="">All products</option>
            {catalogProducts.map(p => (
              <option key={p.id} value={p.id}>{p.name}{p.line_id ? ` (${p.line_id})` : ''}</option>
            ))}
          </select>

          <select value={pf.line_id} onChange={e => patchPf({ line_id: e.target.value })}
            className="px-2 py-1.5 bg-white border border-neutral-200 rounded-lg text-neutral-700 text-sm focus:outline-none w-28 font-mono">
            <option value="">Line ID</option>
            {catalogLineIds.map(lid => <option key={lid} value={lid}>{lid}</option>)}
          </select>

          <select value={pf.product_variant_id} onChange={e => patchPf({ product_variant_id: e.target.value })} disabled={!pf.product_id}
            className="px-2 py-1.5 bg-white border border-neutral-200 rounded-lg text-neutral-700 text-sm focus:outline-none max-w-[180px] disabled:opacity-50">
            <option value="">Variant</option>
            {catalogVariants.map(v => (
              <option key={v.id} value={v.id}>{v.sku || `#${v.id}`}{v.color || v.size ? ` — ${[v.color, v.size].filter(Boolean).join('/')}` : ''}</option>
            ))}
          </select>

          <select value={pf.sku} onChange={e => patchPf({ sku: e.target.value })} disabled={!pf.product_id}
            className="px-2 py-1.5 bg-white border border-neutral-200 rounded-lg text-neutral-700 text-sm focus:outline-none w-28 font-mono disabled:opacity-50">
            <option value="">SKU</option>
            {catalogSkus.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <select value={pf.color} onChange={e => patchPf({ color: e.target.value })} disabled={!pf.product_id}
            className="px-2 py-1.5 bg-white border border-neutral-200 rounded-lg text-neutral-700 text-sm focus:outline-none w-28 disabled:opacity-50">
            <option value="">Color</option>
            {catalogColors.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          <select value={pf.size} onChange={e => patchPf({ size: e.target.value })} disabled={!pf.product_id}
            className="px-2 py-1.5 bg-white border border-neutral-200 rounded-lg text-neutral-700 text-sm focus:outline-none w-28 disabled:opacity-50">
            <option value="">Size</option>
            {catalogSizes.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <select value={pf.paper_type} onChange={e => patchPf({ paper_type: e.target.value })} disabled={!pf.product_id}
            className="px-2 py-1.5 bg-white border border-neutral-200 rounded-lg text-neutral-700 text-sm focus:outline-none w-32 disabled:opacity-50">
            <option value="">Paper</option>
            {catalogPaperTypes.map(p => <option key={p} value={p}>{p}</option>)}
          </select>

          <select value={pf.material_id} onChange={e => patchPf({ material_id: e.target.value })} disabled={!pf.product_id}
            className="px-2 py-1.5 bg-white border border-neutral-200 rounded-lg text-neutral-700 text-sm focus:outline-none max-w-[140px] disabled:opacity-50">
            <option value="">Material</option>
            {catalogMaterials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>

          <select value={pf.accessory_id} onChange={e => patchPf({ accessory_id: e.target.value, accessory_code: '' })} disabled={!pf.product_id}
            className="px-2 py-1.5 bg-white border border-neutral-200 rounded-lg text-neutral-700 text-sm focus:outline-none max-w-[140px] disabled:opacity-50">
            <option value="">Accessory</option>
            {catalogAccessories.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>

          {catalogAccessoryCodes.length > 0 && (
            <select value={pf.accessory_code} onChange={e => patchPf({ accessory_code: e.target.value })}
              className="px-2 py-1.5 bg-white border border-neutral-200 rounded-lg text-neutral-700 text-sm focus:outline-none max-w-[120px]">
              <option value="">Code</option>
              {catalogAccessoryCodes.map(code => <option key={code} value={code}>{code}</option>)}
            </select>
          )}

          {hasActivePf(pf) && (
            <button type="button" onClick={() => patchPf(PF_DEFAULTS)}
              className="px-2 py-1.5 text-xs text-neutral-500 hover:text-red-500">
              ✕ Clear
            </button>
          )}
        </div>

        {/* Bucket sub-tabs */}
        <div className="flex flex-wrap items-center gap-1 border-b border-neutral-100 pb-2">
          <SubChip active={subTab === 'all'} onClick={() => setSubTab('all')}>All <CountBadge n={visibleOrders.length} /></SubChip>
          {bucketList.map(b => (
            <SubChip key={b.key} active={subTab === b.key} onClick={() => setSubTab(b.key)}>
              {b.label} <CountBadge n={b.orders.length} />
            </SubChip>
          ))}
        </div>

        {loading ? (
          <p className="text-neutral-400 text-sm">Loading…</p>
        ) : filteredOrders.length === 0 ? (
          <p className="text-neutral-400 text-sm">
            {subTab === 'all' ? 'No orders assigned to you yet.' : 'No orders in this group.'}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-neutral-500 text-xs border-b border-neutral-200">
                <th className="py-2 text-left w-8"><input type="checkbox" onChange={toggleAll}
                  checked={filteredOrders.length > 0 && filteredOrders.every(o => selectedIds.has(o.id))} className="accent-orange-500" /></th>
                <th className="py-2 text-left">System ID</th>
                <th className="py-2 text-left">Ref</th>
                <th className="py-2 text-left">Line</th>
                <th className="py-2 text-left">SKU</th>
                <th className="py-2 text-left">Accessory</th>
                <th className="py-2 text-left">Code</th>
                <th className="py-2 text-right">_qr</th>
                <th className="py-2 text-right">Doanh thu</th>
              </tr>
            </thead>
            {filteredOrders.map(o => {
              const items = o.items?.length ? o.items : [null];
              // Locked = the partner marked the gang printed, so the amount is
              // settled and admin can no longer edit it.
              const locked = !!o.partner_locked_at;
              return (
                <tbody key={o.id} className="border-b border-neutral-100 hover:bg-orange-50/40">
                  {items.map((it, idx) => {
                    const accs = it ? itemAccessoryList(it) : [];
                    const v = it?.product_variant;
                    return (
                      <tr key={it ? `${o.id}-${it.id}` : o.id} className={idx > 0 ? 'text-neutral-600' : ''}>
                        {idx === 0 && (
                          <>
                            <td className="py-1.5 align-top" rowSpan={items.length}>
                              <input type="checkbox" checked={selectedIds.has(o.id)} onChange={() => toggle(o.id)} className="accent-orange-500" />
                            </td>
                            <td className="py-1.5 align-top font-mono text-orange-500 text-xs" rowSpan={items.length}>{o.system_id}</td>
                            <td className="py-1.5 align-top text-xs text-neutral-600" rowSpan={items.length}>{o.ref_id || '-'}</td>
                          </>
                        )}
                        <td className="py-1.5 text-xs text-neutral-600 font-mono">{v?.product?.line_id || '-'}</td>
                        <td className="py-1.5 text-xs text-neutral-600 font-mono">
                          {v?.sku || '-'}
                          {(v?.color || v?.size) && (
                            <span className="text-neutral-400"> {[v.color, v.size].filter(Boolean).join('/')}</span>
                          )}
                        </td>
                        <td className="py-1.5 text-xs text-neutral-600">
                          {accs.length === 0 ? <span className="text-neutral-300">-</span> : accs.map(a => (
                            <div key={a.key}>
                              {a.style || a.name || '-'}
                              {a.style && a.name && <span className="text-neutral-400"> · {a.name}</span>}
                            </div>
                          ))}
                        </td>
                        <td className="py-1.5 text-xs font-mono text-neutral-700">
                          {accs.length === 0 ? <span className="text-neutral-300">-</span>
                            : accs.map(a => <div key={a.key}>{a.code || <span className="text-neutral-300">-</span>}</div>)}
                        </td>
                        <td className={`py-1.5 text-right ${it && countItemQrMetas(it) ? 'text-neutral-700' : 'text-neutral-300'}`}>
                          {it ? countItemQrMetas(it) : 0}
                        </td>
                        {idx === 0 && (
                          <td className="py-1.5 align-top text-right text-xs font-medium" rowSpan={items.length}>
                            {o.partner_revenue != null
                              ? <span className={locked ? 'text-emerald-600' : 'text-neutral-700'}
                                  title={locked ? `Đã chốt lúc ${new Date(o.partner_locked_at).toLocaleString()}` : 'Chưa chốt (admin còn sửa được)'}>
                                  {locked ? '🔒 ' : ''}${o.partner_revenue}
                                </span>
                              : <span className="text-neutral-300">—</span>}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              );
            })}
            <tfoot>
              {/* Totals follow what is on screen, so switching sub-tab retotals. */}
              <tr className="border-t border-neutral-200 text-xs font-semibold">
                <td colSpan={8} className="py-1.5 text-right text-neutral-500">Tổng doanh thu</td>
                <td className="py-1.5 text-right text-emerald-700">
                  ${filteredOrders.reduce((s, o) => s + (Number(o.partner_revenue) || 0), 0).toFixed(2)}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {progress && (
        <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-neutral-700 mb-2">Processing…</h3>
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
          <h3 className="text-sm font-semibold text-green-700 mb-2">Just created</h3>
          <ul className="text-sm space-y-1">
            {results.map(g => (
              <li key={g.id} className="flex justify-between gap-3">
                <span className="font-mono text-neutral-700 truncate">{g.filename}</span>
                <span className="flex gap-3 shrink-0">
                  {g.png_urls?.length > 0 && (
                    <button type="button" onClick={() => openGangPngs(g)}
                      className="text-emerald-600 hover:text-emerald-700 text-xs"
                      title={`Open ${g.png_urls.length} PNG files`}>
                      Open PNG ({g.png_urls.length})
                    </button>
                  )}
                  <button onClick={() => (window.electronAPI?.openExternal ? window.electronAPI.openExternal(g.file_url) : window.open(g.file_url, '_blank'))}
                    className="text-orange-500 text-xs">Download</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────── Reconvert ───────────────────────────────

/**
 * Find / Re-gang — paste a list of system_ids and rebuild their sheets.
 *
 * Compose only ever shows what is still outstanding; this is how a partner
 * gets back to orders that were already ganged, e.g. to reprint a sheet.
 * Routing and chunking go through the same routeOrdersToChunks as Compose, so
 * a re-gang lands on the sheets the first run would have produced, and
 * includeProduced=true throughout because every meta here is already printed.
 *
 * The lookup is scoped server-side to this partner: an id belonging to someone
 * else comes back under `missing`, never as data.
 */
function FindTab() {
  const [input, setInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [orders, setOrders] = useState([]);
  const [missing, setMissing] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [batchSize, setBatchSize] = useState(loadDefaultBatch);
  const [layoutMap, setLayoutMap] = useState({});
  const [groupBy, setGroupBy] = useState(loadGroupBy);
  const [exportPng, setExportPng] = useState(loadExportPng);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState([]);

  useEffect(() => {
    api.get('/settings/convert-layouts')
      .then(res => setLayoutMap(res.data?.map || {}))
      .catch(() => {});
  }, []);

  const parseIds = (raw) => Array.from(new Set(
    raw.split(/[\s,;\n\r\t]+/).map(s => s.trim()).filter(Boolean)
  ));

  const handleFind = async () => {
    const ids = parseIds(input);
    if (ids.length === 0) { alert('Dán ít nhất một system_id'); return; }
    setSearching(true);
    try {
      const res = await api.post('/partner/orders/lookup', { system_ids: ids });
      setOrders(res.data.orders || []);
      setMissing(res.data.missing || []);
      setSelectedIds(new Set((res.data.orders || []).map(o => o.id)));
    } catch (err) {
      alert(err?.response?.data?.message || 'Tìm thất bại');
    } finally { setSearching(false); }
  };

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
      alert('Tạo gangsheet cần bản desktop (Electron).');
      return;
    }

    const chunks = routeOrdersToChunks(selected, { layoutMap, groupBy, batchSize, includeProduced: true });
    setRunning(true); setResults([]);
    const out = [];
    try {
      const creds = (await api.get('/partner/storage-credentials')).data;

      for (let ci = 0; ci < chunks.length; ci++) {
        const { chunk } = chunks[ci];
        const linePrefix = dominantLineId(chunk);
        const totalInChunk = flattenQrMetas(chunk, { includeProduced: true }).length;
        setProgress({ chunkIndex: ci, totalChunks: chunks.length, done: 0, total: totalInChunk, system_id: '', key: '' });

        const pageFormat = chunkPageFormat(chunks[ci]);
        const built = await buildChunkPdf(chunks[ci], {
          linePrefix, seq: ci + 1, includeProduced: true, collectPages: exportPng,
          onProgress: (p) => setProgress(prev => ({ ...prev, ...p })),
        });

        let pngUrls = null;
        if (exportPng && built.pageBlobs?.length) {
          pngUrls = await uploadGangPngs(built.pageBlobs, {
            creds, pdfFilename: built.baseFilename || built.filename,
            onProgress: (p) => setProgress(prev => ({ ...prev, ...p })),
          });
        }

        const pdfUrls = await uploadGangPdfs(built, creds);

        const res = await api.post('/partner/gangsheets', {
          filename: built.filename,
          file_url: pdfUrls[0],
          png_urls: pngUrls,
          pdf_urls: pdfUrls.length > 1 ? pdfUrls : null,
          line_id: linePrefix || '',
          page_format: pageFormat,
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
      alert(detail + (err?.response?.status ? ` [HTTP ${err.response.status}]` : ''));
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const totalMetas = flattenQrMetas(orders.filter(o => selectedIds.has(o.id)), { includeProduced: true }).length;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm space-y-3">
        <h3 className="text-sm font-semibold text-neutral-700">Tìm đơn theo system_id</h3>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          rows={5}
          placeholder="CCS8089&#10;CCS8090, CCS8091"
          className="w-full px-3 py-2 bg-[#faf8f6] border border-neutral-200 rounded-lg text-sm font-mono"
        />
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={handleFind} disabled={searching}
            className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg">
            {searching ? 'Đang tìm…' : `Tìm (${parseIds(input).length})`}
          </button>
          <PageFormatSelect />
          <label className="flex items-center gap-2 text-sm text-neutral-600">
            <input type="checkbox" checked={exportPng}
              onChange={e => { setExportPng(e.target.checked); saveExportPng(e.target.checked); }}
              className="accent-orange-500" />
            Xuất PNG
          </label>
          <label className="flex items-center gap-2 text-sm text-neutral-600">
            Batch
            <input type="number" min={1} value={batchSize}
              onChange={e => setBatchSize(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="w-20 px-2 py-1 bg-[#faf8f6] border border-neutral-200 rounded text-sm" />
          </label>
        </div>
        {missing.length > 0 && (
          <div className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">
            {/* Not-yours and not-found look the same from here on purpose — the
                lookup is partner-scoped, so we cannot say which it was. */}
            <b>Không tìm thấy ({missing.length}):</b>{' '}
            <span className="font-mono break-all">{missing.join(', ')}</span>
          </div>
        )}
      </div>

      {orders.length > 0 && (
        <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm space-y-3">
          <div className="flex justify-between items-center gap-3 flex-wrap">
            <h3 className="text-sm font-semibold text-neutral-700">
              Đơn tìm được ({orders.length}) · đã chọn {selectedIds.size} · {totalMetas} _qr
            </h3>
            <button onClick={handleGenerate} disabled={running || selectedIds.size === 0}
              className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm rounded-lg font-medium">
              {running ? 'Đang tạo…' : `Tạo gangsheet (${selectedIds.size})`}
            </button>
          </div>

          {progress && (
            <div className="text-xs text-neutral-500">
              Chunk {progress.chunkIndex + 1}/{progress.totalChunks} · {progress.done}/{progress.total}
              {progress.system_id ? ` · ${progress.system_id}` : ''}
            </div>
          )}

          <table className="w-full text-sm">
            <thead>
              <tr className="text-neutral-500 text-xs border-b border-neutral-200">
                <th className="py-2 text-left w-8">
                  <input type="checkbox" onChange={toggleAll}
                    checked={orders.length > 0 && selectedIds.size === orders.length}
                    className="accent-orange-500" />
                </th>
                <th className="py-2 text-left">System ID</th>
                <th className="py-2 text-left">Ref</th>
                <th className="py-2 text-left">Line</th>
                <th className="py-2 text-right">_qr</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(o => (
                <tr key={o.id} className="border-b border-neutral-100 hover:bg-orange-50/40">
                  <td className="py-1.5">
                    <input type="checkbox" checked={selectedIds.has(o.id)} onChange={() => toggle(o.id)}
                      className="accent-orange-500" />
                  </td>
                  <td className="py-1.5 font-mono text-orange-500 text-xs">{o.system_id}</td>
                  <td className="py-1.5 text-xs text-neutral-600">{o.ref_id || '-'}</td>
                  <td className="py-1.5 text-xs text-neutral-600 font-mono">
                    {o.items?.[0]?.product_variant?.product?.line_id || '-'}
                  </td>
                  <td className="py-1.5 text-right text-neutral-700">{countQrMetas(o)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {results.length > 0 && (
        <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm space-y-2">
          <h3 className="text-sm font-semibold text-neutral-700">Đã tạo ({results.length})</h3>
          {results.filter(Boolean).map(g => (
            <div key={g.id} className="text-xs font-mono text-neutral-600 flex items-center gap-2">
              <a href={g.file_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline truncate">
                {g.filename}
              </a>
              {g.png_urls?.length > 0 && (
                <button onClick={() => openGangPngs(g)} className="text-emerald-600 hover:text-emerald-700 font-sans">
                  Mở PNG ({g.png_urls.length})
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
    if (!confirm(`Reconvert ${selectedIds.size} order(s)?\n_qr metas will be deleted and the converter cron will rebuild from mockup URLs.`)) return;
    setRunning(true);
    try {
      const res = await api.post('/partner/orders/reconvert', { order_ids: [...selectedIds] });
      alert(res?.data?.message || `Reconvert queued for ${selectedIds.size} order(s)`);
      await fetchOrders();
    } catch (err) {
      alert(err?.response?.data?.message || 'Reconvert failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm space-y-3">
      <div className="flex justify-between items-end gap-3">
        <div>
          <h3 className="text-sm font-semibold text-neutral-700">Reconvert assigned orders ({orders.length})</h3>
          <p className="text-xs text-neutral-500">Re-render <span className="font-mono">_qr</span> designs for failed prints. The converter cron will rebuild automatically.</p>
        </div>
        <div className="flex gap-2 items-end">
          <button onClick={handleReconvert} disabled={running || selectedIds.size === 0}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm rounded-lg font-medium">
            {running ? 'Processing…' : `Reconvert (${selectedIds.size})`}
          </button>
          <button onClick={fetchOrders} className="px-3 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm rounded-lg">Refresh</button>
        </div>
      </div>

      {loading ? (
        <p className="text-neutral-400 text-sm">Loading…</p>
      ) : orders.length === 0 ? (
        <p className="text-neutral-400 text-sm">No orders assigned to you yet.</p>
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

function ManageTab() {
  const [filters, setFilters] = useState({ date_from: '', date_to: '', line_id: '', page_format: '', page: 1 });
  const [list, setList] = useState({ data: [], current_page: 1, last_page: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [subTab, setSubTab] = useState('all');
  // Bulk select
  const [selectedIds, setSelectedIds] = useState(new Set());
  // PNG export
  const [pngBusyId, setPngBusyId] = useState(null);
  const [pngProgress, setPngProgress] = useState(null);
  // ZIP download
  const [zipping, setZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState(null);
  // Reconvert
  const [reconvertingId, setReconvertingId] = useState(null);

  const patchGang = (id, patch) => setList(prev => ({
    ...prev,
    data: prev.data.map(g => (g.id === id ? { ...g, ...patch } : g)),
  }));

  const fetchList = () => {
    setLoading(true);
    const params = { page: filters.page, per_page: 20 };
    if (filters.date_from) params.date_from = filters.date_from;
    if (filters.date_to) params.date_to = filters.date_to;
    if (filters.line_id) params.line_id = filters.line_id;
    if (filters.page_format) params.page_format = filters.page_format;
    api.get('/partner/gangsheets', { params })
      .then(res => { setList(res.data); setSubTab('all'); setSelectedIds(new Set()); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { fetchList(); }, [filters.page, filters.page_format]);

  const catCounts = {};
  for (const g of list.data) {
    const c = gangCategory(g.filename);
    catCounts[c] = (catCounts[c] || 0) + 1;
  }
  const cats = Object.keys(catCounts).sort((a, b) => catCounts[b] - catCounts[a]);
  const visible = subTab === 'all' ? list.data : list.data.filter(g => gangCategory(g.filename) === subTab);

  const toggleSelected = (id) => setSelectedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleSelectAll = () => {
    const allSel = visible.length > 0 && visible.every(g => selectedIds.has(g.id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSel) visible.forEach(g => next.delete(g.id));
      else visible.forEach(g => next.add(g.id));
      return next;
    });
  };

  const applyFilters = (e) => { e?.preventDefault(); setFilters(f => ({ ...f, page: 1 })); setTimeout(fetchList, 0); };
  const clearFilters = () => { setFilters({ date_from: '', date_to: '', line_id: '', page_format: '', page: 1 }); setTimeout(fetchList, 0); };

  const openLink = (url) => {
    if (window.electronAPI?.openExternal) window.electronAPI.openExternal(url);
    else window.open(url, '_blank');
  };

  const togglePrinted = async (g) => {
    const printed = !g.pivot?.printed_at;
    patchGang(g.id, { pivot: { ...g.pivot, printed_at: printed ? new Date().toISOString() : null } });
    try {
      await api.post(`/partner/gangsheets/${g.id}/printed`, { printed });
    } catch {
      fetchList();
    }
  };

  // PNG export: rasterize PDF → upload pages → save URLs
  const handleExportPng = async (g, { force = false } = {}) => {
    if (g.png_urls?.length && !force) { openGangPngs(g); return; }
    if (!window.electronAPI?.s3Upload) {
      alert('PNG export requires the desktop app (Electron).');
      return;
    }
    setPngBusyId(g.id);
    setPngProgress({ done: 0, total: 0 });
    try {
      const credsRes = await api.get('/partner/storage-credentials');
      const creds = credsRes.data;
      const blobs = await rasterizeGangPdf(g.file_url, {
        onProgress: (p) => setPngProgress(p),
      });
      const urls = await uploadGangPngs(blobs, {
        creds, pdfFilename: g.filename,
        onProgress: (p) => setPngProgress({ done: p.pngDone, total: p.pngTotal }),
      });
      const res = await api.put(`/partner/gangsheets/${g.id}/png-urls`, { png_urls: urls, force });
      patchGang(g.id, { png_urls: res.data.gangsheet?.png_urls || urls });
      alert(`${force ? 'Re-exported' : 'Exported'} ${urls.length} PNG file(s)`);
    } catch (err) {
      alert(err?.response?.data?.message || err?.message || 'PNG export failed');
    } finally {
      setPngBusyId(null);
      setPngProgress(null);
    }
  };

  // Bulk: ZIP all PNGs from selected gangs
  const handleDownloadPngZip = async () => {
    const gangs = list.data.filter(g => selectedIds.has(g.id));
    if (gangs.length === 0) return;
    setZipping(true);
    setZipProgress({ done: 0, total: 0 });
    try {
      const { zipSync } = await import('fflate');
      const withPng = gangs.filter(g => g.png_urls?.length);
      const urls = withPng.flatMap(g => g.png_urls);
      if (urls.length === 0) throw new Error('Selected gangsheets have no PNG files');

      const files = {};
      let done = 0;
      for (const url of urls) {
        const name = decodeURIComponent(String(url).split('/').pop() || `page_${done + 1}.png`);
        files[name] = await fetchFileBytes(url);
        setZipProgress({ done: ++done, total: urls.length });
      }

      const zipped = zipSync(files, { level: 0 });
      const zipName = withPng.length === 1
        ? `${String(withPng[0].filename || 'gangsheet').replace(/\.pdf$/i, '')}_png.zip`
        : `gangsheet_png_${withPng.length}gang_${urls.length}file.zip`;

      const blobUrl = URL.createObjectURL(new Blob([zipped], { type: 'application/zip' }));
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = zipName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      alert(`${zipName} — ${urls.length} PNG from ${withPng.length} gang(s)`);
    } catch (err) {
      alert(err?.message || 'PNG download failed');
    } finally {
      setZipping(false);
      setZipProgress(null);
    }
  };

  // Reconvert all orders in a gangsheet
  const handleReconvertGang = async (g) => {
    if (!confirm(`Reconvert orders in gangsheet ${g.filename}?\n_qr metas will be deleted and the converter cron will rebuild.`)) return;
    setReconvertingId(g.id);
    try {
      const res = await api.post(`/partner/gangsheets/${g.id}/reconvert`);
      alert(res?.data?.message || 'Reconvert queued');
    } catch (err) {
      alert(err?.response?.data?.message || 'Reconvert failed');
    } finally {
      setReconvertingId(null);
    }
  };

  return (
    <div className="space-y-4">
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
        <button
          type="button"
          onClick={handleDownloadPngZip}
          disabled={selectedIds.size === 0 || zipping}
          className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-white text-sm rounded-lg"
          title="Download all PNG files from selected gangsheets as a .zip"
        >
          {zipping
            ? `Zipping ${zipProgress?.done ?? 0}/${zipProgress?.total ?? '?'}…`
            : `PNG .zip (${selectedIds.size})`}
        </button>
        <span className="text-xs text-neutral-500 ml-auto">
          <span className="font-semibold text-green-600">{list.data.filter(g => g.pivot?.printed_at).length}</span>
          {' / '}
          <span className="font-semibold">{list.data.length}</span>
          {' printed · Total: '}
          {list.total ?? 0}
        </span>
      </form>

      <div className="flex flex-wrap items-center gap-1">
        <span className="text-xs text-neutral-500 mr-1">Format:</span>
        <SubChip active={filters.page_format === ''} onClick={() => setFilters(f => ({ ...f, page_format: '', page: 1 }))}>All</SubChip>
        <SubChip active={filters.page_format === 'original'} onClick={() => setFilters(f => ({ ...f, page_format: 'original', page: 1 }))}>Default (10×7)</SubChip>
        <SubChip active={filters.page_format === 'letter'} onClick={() => setFilters(f => ({ ...f, page_format: 'letter', page: 1 }))}>Letter 11×8.5</SubChip>
      </div>

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

      <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-neutral-500 text-xs bg-[#faf8f6] border-b border-neutral-200">
              <th className="px-3 py-2 text-center w-8">
                <input type="checkbox" onChange={toggleSelectAll}
                  checked={visible.length > 0 && visible.every(g => selectedIds.has(g.id))}
                  className="accent-orange-500" title="Select all visible" />
              </th>
              <th className="px-3 py-2 text-center w-10" title="Printed">Printed</th>
              <th className="px-3 py-2 text-left">Filename</th>
              <th className="px-3 py-2 text-left">Range</th>
              <th className="px-3 py-2 text-left">Line</th>
              <th className="px-3 py-2 text-right">Orders</th>
              <th className="px-3 py-2 text-right">Metas</th>
              <th className="px-3 py-2 text-left">Creator</th>
              <th className="px-3 py-2 text-left">When</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="p-6 text-center text-neutral-400">Loading…</td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={10} className="p-6 text-center text-neutral-400">No gangsheets assigned yet.</td></tr>
            ) : visible.map(g => {
              const isPrinted = !!g.pivot?.printed_at;
              const isSel = selectedIds.has(g.id);
              return (
              <tr key={g.id} className={`border-b border-neutral-100 hover:bg-orange-50/30 ${isSel ? 'bg-orange-50/60' : isPrinted ? 'bg-green-50/40' : ''}`}>
                <td className="px-3 py-2 text-center">
                  <input type="checkbox" checked={isSel} onChange={() => toggleSelected(g.id)} className="accent-orange-500" />
                </td>
                <td className="px-3 py-2 text-center">
                  <button
                    onClick={() => togglePrinted(g)}
                    title={isPrinted ? `Printed ${new Date(g.pivot.printed_at).toLocaleString()} — click to unmark` : 'Not printed — click to mark'}
                    className={`w-6 h-6 rounded border-2 flex items-center justify-center text-base transition ${
                      isPrinted
                        ? 'bg-emerald-500 border-emerald-600 text-white'
                        : 'bg-white border-neutral-300 hover:border-emerald-400 text-transparent hover:text-emerald-300'
                    }`}
                  >
                    ✓
                  </button>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-neutral-700 truncate max-w-[260px]">{g.filename}</td>
                <td className="px-3 py-2 font-mono text-xs text-neutral-500">
                  {g.first_system_id}{g.first_system_id !== g.last_system_id && <> → {g.last_system_id}</>}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{g.line_id || '-'}</td>
                <td className="px-3 py-2 text-right">{g.orders_count}</td>
                <td className="px-3 py-2 text-right">{g.metas_count}</td>
                <td className="px-3 py-2 text-xs">{g.creator?.name || '-'}</td>
                <td className="px-3 py-2 text-xs text-neutral-500">{new Date(g.created_at).toLocaleString()}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex gap-3 justify-end">
                    <button onClick={() => setDetail(g)} className="text-xs text-neutral-600 hover:text-neutral-800">Detail</button>
                    <button onClick={() => openLink(g.file_url)} className="text-xs text-orange-500 hover:text-orange-600">Download</button>
                    <button
                      onClick={() => handleExportPng(g)}
                      disabled={pngBusyId === g.id}
                      className="text-xs text-emerald-600 hover:text-emerald-700 disabled:opacity-40"
                      title={g.png_urls?.length
                        ? `Open ${g.png_urls.length} exported PNG file(s)`
                        : 'Split this gang PDF into individual PNG pages and upload to B2'}
                    >
                      {pngBusyId === g.id
                        ? `PNG ${pngProgress?.done ?? 0}/${pngProgress?.total ?? '?'}…`
                        : (g.png_urls?.length ? `Open PNG (${g.png_urls.length})` : 'Export PNG')}
                    </button>
                    {g.png_urls?.length > 0 && (
                      <button
                        onClick={() => handleExportPng(g, { force: true })}
                        disabled={pngBusyId === g.id}
                        className="text-xs text-emerald-600/70 hover:text-emerald-700 disabled:opacity-40"
                        title="Re-export PNG from the current PDF and overwrite existing files"
                      >
                        Re-export
                      </button>
                    )}
                    <button
                      onClick={() => handleReconvertGang(g)}
                      disabled={reconvertingId === g.id}
                      className="text-xs text-blue-600 hover:text-blue-700 disabled:opacity-40"
                      title="Delete _qr metas for orders in this gang; cron rebuilds from mockup URLs"
                    >
                      {reconvertingId === g.id ? 'Reconverting…' : 'Reconvert'}
                    </button>
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

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
          ) : !data ? (
            <p className="text-neutral-400 text-sm">No data.</p>
          ) : (
            <>
              {/* PNG links */}
              {data.gangsheet?.png_urls?.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-1">
                  {data.gangsheet.png_urls.map((url, i) => (
                    <button key={i} onClick={() => openLink(url)} className="text-emerald-600 text-xs hover:underline">
                      PNG p{i + 1}
                    </button>
                  ))}
                </div>
              )}
              <h4 className="text-xs font-semibold text-neutral-600 uppercase mb-2">Orders ({data.orders.length})</h4>
              {data.orders.length === 0 ? (
                <p className="text-neutral-400 text-sm">No orders found.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-neutral-500 text-xs border-b border-neutral-200">
                      <th className="py-2 text-left">System ID</th>
                      <th className="py-2 text-left">Ref</th>
                      <th className="py-2 text-right">Total</th>
                      <th className="py-2 text-right">Partner Rev</th>
                      <th className="py-2 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.orders.map(o => (
                      <tr key={o.id} className="border-b border-neutral-100">
                        <td className="py-1.5 font-mono text-orange-500 text-xs">{o.system_id}</td>
                        <td className="py-1.5 text-xs text-neutral-600">{o.ref_id || '-'}</td>
                        <td className="py-1.5 text-right">${o.total_cost}</td>
                        <td className="py-1.5 text-right text-emerald-600 font-medium">
                          {o.partner_revenue != null ? `$${o.partner_revenue}` : '-'}
                        </td>
                        <td className="py-1.5 text-right text-xs">{o.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
