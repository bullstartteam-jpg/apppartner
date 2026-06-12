# BullStart Partner

App desktop (Electron + React 19 + Tailwind v4 + React Router v7) cho **partner —
xưởng in**. Partner tự gom (compose) và render lại (reconvert) các đơn nằm trong
những gangsheet mà admin đã **chia** cho mình, rồi in. Native Windows / Mac / Linux
installer qua electron-builder, auto-update qua electron-updater.

- Tài khoản: **chỉ role `partner`** mới vào được (admin cũng được, để hỗ trợ/test).
  Gate ở `src/renderer/App.jsx` → check `user.role.slug`. Account khác login vẫn
  được nhưng sẽ thấy trang "Chỉ partner mới được truy cập" và phải logout.
- Backend: `https://bullstart.us/api` (đổi runtime qua `localStorage.api_url`).
  Mọi route `/partner/*` đã được scope phía server theo từng partner.

## Tính năng

Trang **Gangsheet** có 3 tab:

- **Compose** — lấy các đơn được giao (`GET /partner/orders`, chỉ đơn nằm trong gang
  admin đã chia cho bạn), chọn + gom thành PDF gangsheet ngay trong app (build bằng
  `pdf-lib`, `includeProduced` vì đơn đã produced), upload thẳng B2 qua
  `s3Upload`, rồi ghi nhận qua `POST /partner/gangsheets`. Gang tạo ra **tự gán lại
  cho chính bạn**. Có chọn số đơn/batch + khổ giấy (Default 10×7 / Letter 11×8.5).
- **Reconvert** — chọn đơn được giao → `POST /partner/orders/reconvert`: xoá meta
  `_qr` + bỏ cờ production để converter cron của hub build lại từ mockup URL (sửa
  design in lỗi). Scoped phía server, chỉ đụng được đơn của bạn.
- **Đã chia** — danh sách gangsheet admin đã chia cho bạn (`GET /partner/gangsheets`).
  Lọc theo ngày / line / khổ giấy + chip phân loại (parse từ filename), xem Detail,
  Download, và tick **"đã in"** (`POST /partner/gangsheets/{id}/printed`).

Trang **Dashboard**: tổng quan số gangsheet / đơn / design được chia
(`GET /partner/dashboard`).

## Backend endpoints dùng tới

```
GET  /partner/dashboard
GET  /partner/gangsheets                 # list assigned (date_from/date_to/line_id/page_format)
GET  /partner/gangsheets/{id}            # detail + orders
POST /partner/gangsheets/{id}/printed    # tick "đã in"
GET  /partner/orders                     # đơn trong các gang được chia (nguồn compose/reconvert)
GET  /partner/storage-credentials        # B2 creds để upload PDF
POST /partner/gangsheets                 # ghi gang vừa compose (tự gán cho partner)
POST /partner/orders/reconvert           # reconvert đơn của mình
```

Tất cả nằm sau middleware `CheckRole:partner,admin` ở `hubbullstart/routes/api.php`.

## Dev local

```bash
cd D:/bs/partner-bullstart
npm install                                                       # 1 lần

# Cách 1 — build renderer rồi mở app
npx webpack --config webpack.renderer.config.js --mode development
npx electron .

# Cách 2 — hot reload (2 terminal)
BS_DEV=1 npx webpack serve --config webpack.renderer.config.js    # dev server :3000
BS_DEV=1 npx electron .                                           # main.js load :3000 khi BS_DEV=1
```

`main.js` chỉ load dev-server khi có **`BS_DEV=1`** (không dùng `NODE_ENV`, tránh ăn
nhầm dev-server của app khác trên :3000). Mặc định luôn load `build/index.html`.

## Build production

```bash
npm run build:renderer   # bundle.js vào ./build
npm run build:win        # .exe NSIS installer trong ./dist
npm run build:mac        # .dmg
npm run build:linux      # AppImage
```

> Compose cần `pdf-lib` + `@aws-sdk/client-s3` (build PDF + upload B2) và 2 IPC
> `fetch-image` / `s3-upload` ở main process. Nhớ build lại installer sau khi đổi
> các dependency / IPC này — bản auto-update cũ sẽ thiếu chúng.

## Auto-update

`electron-updater` + GitHub Releases. Bump version + push tag `vX.Y.Z` lên
`bullstartteam-jpg/apppartner` (publish config trong `package.json`):

```bash
npm version patch              # bump + tạo commit + tag
git push origin main --tags
npm run build:win              # local build → upload lên GitHub Release nếu có GH_TOKEN
```

User đã cài sẽ nhận update tự động ở lần khởi động kế tiếp.

## Quyền truy cập

**Chỉ partner** (admin được phép, để hỗ trợ). Gate trong `src/renderer/App.jsx`:

```jsx
const slug = user.role?.slug;
if (slug !== 'partner' && slug !== 'admin') {
  return <div>Chỉ partner mới được truy cập</div>;
}
```

Backend cũng gate `/partner/*` ở `CheckRole:partner,admin` — defense in depth. Quan
trọng: `POST /partner/gangsheets` và `/partner/orders/reconvert` còn kiểm tra mọi
`order_id` phải thuộc gang đã chia cho chính partner đó (403 nếu vượt).

## License

Proprietary — © BullStart Team.
