# BullStart Inventory

App desktop riêng cho quản lý kho. Native Windows / Mac / Linux installer
qua electron-builder, auto-update qua electron-updater.

- Tài khoản: **chỉ admin mới được login** (gate ở App.jsx → check
  `user.role.slug === 'admin'`). Account khác login vẫn được nhưng sẽ thấy
  trang "Chỉ admin mới được truy cập" và phải logout.
- Backend: `https://bullstart.us/api` (giống các app khác).
- Phase 1 (release đầu): Dashboard, Inventory (full feature từ admin app),
  Movements log.

## Dev local

```bash
cd D:/bs/inventory-bullstart
npm install                                                       # 1 lần
npx webpack --config webpack.renderer.config.js --mode development # build renderer
npx electron .                                                    # mở app
```

Hoặc dev với hot-reload (2 terminal):

```bash
# Terminal 1 — webpack dev server, port 3000
npx webpack serve --config webpack.renderer.config.js

# Terminal 2 — electron loads http://localhost:3000 khi NODE_ENV=development
NODE_ENV=development npx electron .
```

## Build production

```bash
npm run build:renderer   # bundle.js vào ./build
npm run build:win        # .exe NSIS installer trong ./dist
npm run build:mac        # .dmg
npm run build:linux      # AppImage
```

## Auto-update

Sử dụng `electron-updater` + GitHub Releases. Mỗi lần bump version + push tag
`vX.Y.Z` lên `bullstartteam-jpg/inventory-app-bs` (publish config trong
`package.json`):

```bash
npm version patch              # bump 1.0.0 → 1.0.1, tạo commit + tag tự động
git push origin main --tags
npm run build:win              # local build → tự upload lên GitHub Release nếu có GH_TOKEN
```

User đã cài app sẽ nhận update tự động ở lần khởi động kế tiếp.

## Quyền truy cập

**Chỉ admin** mới vào được. Gate trong `src/renderer/App.jsx`:

```jsx
if (user.role?.slug !== 'admin') {
  return <div>Chỉ admin mới được truy cập</div>;
}
```

Backend cũng đã gate tất cả `/api/inventory/*` routes ở
`CheckRole::class . ':admin'` middleware — defense in depth. Account
warehouse/seller dù login được cũng không gọi được API.

Nếu sau này muốn cho role `warehouse` truy cập (Phase 2+):
1. Thêm slug `warehouse` vào `roles` table
2. Sửa gate App.jsx: `if (!['admin','warehouse'].includes(user.role?.slug))`
3. Update backend route middleware tương ứng:
   `CheckRole::class . ':admin,warehouse'`
4. Grant permission `inventory` cho role mới:
   ```sql
   INSERT INTO permissions (role_id, module, can_view, can_create, can_edit, can_delete, created_at, updated_at)
   SELECT id, 'inventory', 1, 1, 1, 1, NOW(), NOW() FROM roles WHERE slug = 'warehouse';
   ```

## Quy ước

- Source 1:1 copy từ `bullstart-seller` skeleton (Auth context, Dialog,
  Preview helpers). Phase 2+ sẽ phân kỳ — không sync ngược.
- `pages/Inventory.jsx` sao chép từ `bullstart` admin app. Khi admin app
  cập nhật page này, đồng bộ tay sang:
  ```bash
  cp D:/bs/bullstart/src/renderer/pages/Inventory.jsx D:/bs/inventory-bullstart/src/renderer/pages/
  ```
- Roadmap chi tiết: xem [ROADMAP.md](./ROADMAP.md).

## License

Proprietary — © BullStart Team.
