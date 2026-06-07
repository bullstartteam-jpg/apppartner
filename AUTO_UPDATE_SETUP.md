# Auto-update setup — BullStart Seller

App uses [`electron-updater`](https://www.electron.build/auto-update) and pulls
release artifacts from the GitHub repo
[`bullstartteam-jpg/seller-app-bs`](https://github.com/bullstartteam-jpg/seller-app-bs).

## How it works

1. End user runs an installed `BullStart Seller` app.
2. On launch (packaged build only), the app calls `autoUpdater.checkForUpdates()`.
3. electron-updater downloads `latest.yml` from the GitHub release feed.
4. If the published `version` is greater than `app.getVersion()`, the new
   installer is downloaded in the background.
5. When the download finishes, a dialog asks the user to restart now or later;
   either way the update is applied at next quit.

## Initial setup

### Public vs private repo

| | Public repo | Private repo |
|---|---|---|
| End-user fetch | No token | Need `GH_TOKEN` baked into binary |
| Setup effort | Low | Higher (PAT + token security trade-off) |
| Source visibility | Anyone | Team only |

If repo is **public**, no token configuration is needed — skip to **Release flow**.

### Private repo extra step

If `seller-app-bs` is private, end users still need read access to the release
assets. The simplest pattern:

1. Create a **fine-grained PAT** with `Contents: Read-only` on the repo.
2. Add this token to your CI as `GH_TOKEN_RUNTIME` (separate from
   `GITHUB_TOKEN` used by the workflow).
3. Inject it into the build at compile time, e.g. via
   `webpack.DefinePlugin({ 'process.env.GH_TOKEN': ... })`, or set it on the
   user's machine and read at runtime. The token will be visible to anyone
   who decompiles the .exe — make sure its scope is read-only.

For now this app assumes **public** releases. To stay private, follow up with
the token approach or switch to a `provider: 'generic'` with self-hosted
artifacts (B2/S3).

## Release flow

```bash
# Bump version in package.json
npm version patch        # or minor / major

# Push the commit + tag (tag name must match v<version>)
git push --follow-tags
```

GitHub Actions (`.github/workflows/release.yml`) runs:

1. `npm ci`
2. `npm run build:renderer`
3. `npx electron-builder --win --publish always`

`electron-builder` then creates a Release on GitHub and uploads:

- `BullStart Seller Setup <version>.exe`
- `latest.yml`
- block-map for delta downloads

End users on the previous version pick up the update on next launch.

## Optional but recommended

- **Code signing** for Windows: avoids SmartScreen warnings. Cost ~$100-300/yr
  for an OV/EV cert from Sectigo/DigiCert. Configure in `package.json`:
  ```json
  "win": {
    "certificateFile": "...",
    "certificatePassword": "..."
  }
  ```
- **macOS notarization**: required for distribution outside the App Store on
  modern macOS. Needs Apple Developer Program ($99/yr).

## Troubleshooting

- `Error: ENOENT: no such file or directory, open 'app-update.yml'` —
  the build wasn't done with electron-builder, or `publish` config is wrong.
  Run `npm run build:win` once locally to verify.
- `404 Not Found` when checking for updates — the GitHub release doesn't yet
  exist, or `latest.yml` failed to upload. Check the Actions run.
- App keeps trying to install but version stays the same — make sure
  `package.json` `version` is bumped before tagging.
