# Roadmap — BullStart Inventory

App quản lý kho hiện đại đầy đủ tính năng. Phase 1 đã ship với core MVP;
phase 2-5 là kế hoạch mở rộng theo mức ưu tiên.

> Quy ước version: mỗi phase = 1 minor bump. v1.x = phase 1, v2.x = phase 2, …
> Backend changes (nếu có) tag tại `hubbullstart` cùng tên `inventory-phaseN`.

---

## ✅ Phase 1 — MVP (v1.0.0) — đã ship

**Mục tiêu**: đưa lên không khí toàn bộ pipeline hiện có ở admin app, dạng app riêng.

- [x] Auth: login bằng account bullstart, gate qua permission `inventory.can_view`
- [x] **Dashboard**: 5 stat card (tổng SKU, tổng units, hết hàng, sắp hết, stock âm) +
      list cảnh báo + 8 lần nhập gần đây
- [x] **Inventory page**:
  - History import (paginated)
  - New Import form (per_item / per_package)
  - Bulk CSV import + template export
  - Current stock (variants + accessories tách bảng)
  - Resync stock (Σ imports − Σ shipped)
  - Delete import (đảo stock)
- [x] **Movements log**: read-only, hiện các lần nhập (+qty). Filter target / date
- [x] Branding "BullStart Inventory" (sidebar, window title, app id)
- [x] Auto-update via electron-updater + GitHub Releases

**Backend endpoint reuse** (đã có ở hubbullstart):
- `GET/POST /api/inventory/imports`
- `DELETE /api/inventory/imports/{id}`
- `GET /api/inventory/imports/template`
- `POST /api/inventory/imports/bulk`
- `GET /api/inventory/stock`
- `POST /api/inventory/resync`

---

## 🚧 Phase 2 — Operations (v2.0.0)

**Mục tiêu**: warehouse staff làm việc hằng ngày — counts, adjustments, alerts.

### Stock take / cycle count
- Endpoint mới: `POST /api/inventory/stock-takes` — create cycle count session
- UI: chọn N SKU (theo product, line, hoặc all) → in count sheet → operator điền số đếm thực tế → upload → diff với system stock → admin approve → tạo adjustment rows
- Lưu lại lịch sử count: ai count, khi nào, variance %

### Manual stock adjustment
- Migration: `stock_adjustments` table (variant_id / accessory_price_id, delta, reason, user_id, created_at, notes)
- Reasons enum: `damage`, `loss`, `found`, `cycle_count_diff`, `correction`, `return`
- Endpoint: `POST /api/inventory/adjustments`
- UI: form quick adjustment ngay trên row của Current Stock
- Resync mới sẽ tính: `stock = Σ imports − Σ shipped + Σ adjustments.delta`

### Low-stock alerts
- Migration: `product_variants.low_stock_threshold` + `accessory_prices.low_stock_threshold`
  (default null = không alert)
- Dashboard: highlight đỏ + đếm số SKU dưới ngưỡng riêng từng SKU thay vì
  threshold cố định
- Daily cron: `inventory:check-low-stock` → email admin list SKU sắp hết
- UI: cột threshold edit-inline trong Current Stock

### Barcode scan input
- Khi nhập / count, focus 1 input → cắm máy scan USB → đọc SKU/code → auto
  lookup variant
- Web Bluetooth nếu scan wireless (advanced)

**Estimated effort**: 2-3 tuần dev + test.

---

## 🚧 Phase 3 — Suppliers + Purchase Orders (v3.0.0)

**Mục tiêu**: theo dõi nhập hàng có structure (không phải free-form stock_imports).

### Suppliers CRUD
- Migration: `suppliers` (name, contact, email, phone, address, terms, notes)
- Page Suppliers: list + CRUD
- Liên kết `stock_imports.supplier_id`

### Purchase Orders
- Migration: `purchase_orders` (po_number, supplier_id, status, expected_at, total_cost) + `purchase_order_items` (variant_id / accessory_price_id, quantity, unit_price)
- Status: draft / sent / receiving / received / cancelled
- Flow:
  1. Create PO → status draft
  2. Send PO → status sent (PDF generate, email supplier)
  3. Khi nhận hàng → "Receive against PO" → mỗi line ghi nhận qty received (có thể nhận từng đợt)
  4. Khi nhận đủ → status received → tự sinh `stock_imports` rows tương ứng → bump stock
- UI: page POs + detail page với progress bar
- Reports: outstanding POs, overdue POs, supplier scorecard

### Cost tracking
- `stock_imports.unit_price` đã có → tính moving average cost per SKU
- Endpoint: `GET /api/inventory/cost-history/{variant_id}` → graph giá nhập theo thời gian
- Dashboard widget: "Chi phí kho tháng này"

**Estimated effort**: 4-5 tuần.

---

## 🚧 Phase 4 — Locations + Lot/Batch (v4.0.0)

**Mục tiêu**: tracking nâng cao cho kho lớn / nhiều khu / sản phẩm có hạn dùng.

### Locations / Bins
- Migration: `warehouses` (name, code, address) + `bins` (warehouse_id, code, capacity)
- Migration: `variant_bin_stock` (variant_id, bin_id, quantity) — thay thế cột stock đơn của variant
- Default warehouse cho install hiện tại để không break Phase 1-3
- UI: page Warehouses + Bins map (grid view)
- Flow: khi nhập → chọn bin chứa. Khi pick (ship) → suggest bin có sẵn

### Lot/batch tracking
- Migration: `lots` (variant_id, lot_number, expiry_date, supplier_lot_ref, received_at)
- Migration: `stock_movements` ghi nhận lot_id → biết exactly lot nào đang ở đâu
- FIFO/FEFO picking: shipped order tự ưu tiên lot expire sớm nhất
- Alert lot sắp hết hạn

**Estimated effort**: 6-8 tuần. Đây là refactor schema sâu — cần migration plan kỹ.

---

## 🚧 Phase 5 — Reports + Analytics (v5.0.0)

**Mục tiêu**: dashboard quản lý ra quyết định.

- **ABC analysis**: phân loại SKU theo Pareto (A = 80% revenue, B = 15%, C = 5%)
- **Turnover ratio**: avg stock / sales velocity → biết SKU nào "đứng kho"
- **Aging report**: SKU tồn bao lâu (theo lô)
- **Forecasting**: simple moving average / seasonality để gợi ý lượng cần nhập
- **Stock value**: tổng giá trị kho theo cost / sell price
- **Heatmap**: theo line, theo tier, theo location
- Export PDF / Excel cho mỗi report

**Estimated effort**: 3-4 tuần.

---

## Backlog (chưa schedule)

- Multi-language UI (English/Vietnamese toggle)
- Activity feed real-time (websocket khi stock thay đổi)
- Mobile companion app (Capacitor) — scan SKU + adjust trên điện thoại
- Integration Slack/Telegram: notify khi low stock / large adjustment
- Photo của lot/box upload + OCR
- Returns/RMA module (link với order shipped → trả hàng vào kho)
- Audit log đầy đủ: ai làm gì, khi nào, IP, user-agent
- Backup/restore tự động
- API public + webhook cho integration

---

## Nguyên tắc chung

1. **Backward compat**: mọi phase mới phải migrate data cũ không mất, không
   yêu cầu re-seed.
2. **Backend trước, frontend sau**: API endpoint định nghĩa stable rồi mới
   build UI — tránh phải sửa cả 2 bên.
3. **Test với data thật**: mỗi phase deploy lên staging với snapshot prod
   trước khi release.
4. **Doc song hành**: mỗi phase update `doc/inventory.md` (hub side) +
   README/ROADMAP (app side).
5. **Permission granular**: phase 2+ split `inventory` thành sub-modules
   (`inventory.adjust`, `inventory.po`, `inventory.report`…) để phân quyền
   chi tiết hơn.
