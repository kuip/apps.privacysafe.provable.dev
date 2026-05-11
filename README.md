# apps.privacysafe.provable.dev

Shared repo for Provable PrivacySafe apps.

This repository has two roles:

1. source tree for individual apps stored under subfolders
2. GitHub Actions-built Pages artifact that serves app discovery files under the custom domain

## Domain discovery

Each app keeps its own app domain, but points at this shared host through a DNS TXT record.

Example:

- app domain: `kayros.app.provable.dev`
- TXT record:
  - `w3n-app=apps.privacysafe.provable.dev/kayros`

PrivacySafe resolves the TXT record on the app domain, prepends `https://`, and then fetches the hosted discovery files from this repository's Pages site.

## Current apps

- `kayros/`
- `nomen/`
- `wallet/`

## Local Pages build

```bash
cd ./apps.privacysafe.provable.dev/kayros
npm run pack:discovery

cd ./apps.privacysafe.provable.dev/nomen
npm run pack:discovery

cd ./apps.privacysafe.provable.dev
node scripts/build-pages-site.mjs
```

This generates:

- `build/pages/index.html`
- `build/pages/CNAME`
- `build/pages/kayros/...`
- `build/pages/nomen/...`

## Release model

The hosted discovery tree is versioned, for example:

- `/kayros/0.1.16/list`
- `/kayros/0.1.16/unpacked/...`

Current workflow intent:

- push to `main`: validate/build only
- tag like `kayros-v0.1.17`: publish Pages and create Kayros release assets
- tag like `nomen-v0.1.1`: publish Pages and create Nomen release assets

Recommended release flow:

```bash
cd ./apps.privacysafe.provable.dev
make publish-kayros
make publish-nomen
```

These commands will:

- print the current app version
- ask for the next version
- update that app's `package.json` and `manifest.json`
- build the local release artifacts
- commit the version bump
- create an app-specific release tag
- push the branch and tag

Then GitHub Actions will:

- build the released app
- generate the discovery site
- deploy Pages
- attach the install zip and discovery archive to the GitHub release

Tag conventions:

- Kayros: `kayros-vX.Y.Z`
- Nomen: `nomen-vX.Y.Z`

## Publish Kayros discovery files manually

```bash
cd kayros
npm run pack:discovery

cd ..
node scripts/build-pages-site.mjs
```

This updates the hosted discovery tree under `./build/pages/kayros/`.

## Local dev without repacking

Use PrivacySafe platform's `--test-stand` mode and point the Provable helper apps at live Vite URLs.

Quick entrypoint:

```bash
cd ./apps.privacysafe.provable.dev
make dev
```

That starts the local dev stack, prefixes logs from each child process, and shuts the whole stack down on Ctrl+C.

The processes it orchestrates are:

- `startup.app.privacysafe.io` Vite dev server
- `nomen.app.provable.dev` Vite dev server
- `kayros.app.provable.dev` Vite dev server
- `wallet.app.provable.dev` Vite dev server
- `treasure.app.privacysafe.io` Vite dev server from `../gitlab/treasure.app.privacysafe.io`
- `privacysafe-platform-electron` in test-stand mode

1. Ensure the startup and Kayros app folders exist once:

```bash
mkdir -p ../startup.app.privacysafe.io/app
mkdir -p ./kayros/app
mkdir -p ./wallet/app
mkdir -p ../gitlab/treasure.app.privacysafe.io/app
```

2. Start the startup app dev server:

```bash
cd ../startup.app.privacysafe.io
pnpm install
pnpm dev --host 127.0.0.1
```

3. Start the Nomen PrivacySafe helper app dev server:

```bash
cd ./nomen
npm run dev -- --host 127.0.0.1 --port 5174
```

4. Start the Kayros app dev server:

```bash
cd ./kayros
npm run dev -- --host 127.0.0.1 --port 5175
```

5. Start the Wallet app dev server:

```bash
cd ./wallet
npm run dev -- --host 127.0.0.1 --port 5176
```

6. Build Treasure's Deno service once and start its UI dev server:

```bash
cd ../gitlab/treasure.app.privacysafe.io
pnpm build:deno
pnpm dev --host 127.0.0.1 --port 3031
```

7. Start PrivacySafe from the mac bundle repo with the example test-stand config:

```bash
cd ../privacysafe-platform-electron/mac
npm ci
npm run compile platform
npm run start-app -- \
  --data-dir=./3NWeb-data-provable-dev \
  --test-stand=../../apps.privacysafe.provable.dev/test-stand.dev.example.json
```

There is no separate `--develop` flag in the platform code. The development path is the normal Electron app start with:

- `--devtools` already included in `npm run start-app`
- `--test-stand` for loading local apps from folders and live Vite URLs

This mode uses:

- local manifest/caps from `nomen/`
- local manifest/caps from `kayros/`
- live UI from `http://127.0.0.1:5174`
- live UI from `http://127.0.0.1:5175`
- live UI from `http://127.0.0.1:5176`
- local Treasure manifest/service bundle from `../gitlab/treasure.app.privacysafe.io`
- live Treasure UI from `http://127.0.0.1:3031`
- local startup UI from `http://127.0.0.1:3030`

So helper-app UI changes reload from Vite without rebuilding or packing the app zip each time.

## GitLab Test Stand Mode

The `../gitlab` folder contains the current local test-stand setup with staged bundled apps and `core-platform-electron`.

Build and stage all configured apps:

```bash
cd ../gitlab
./build-apps.sh
```

Build and stage only the wallet app:

```bash
cd ../gitlab
./build-apps.sh wallet
```

The build script installs app dependencies from their checked-in lockfiles. For the wallet this means `npm ci --ignore-scripts` before `npm run build`, so dependency resolution fails if `package-lock.json` is stale.

Start `core-platform-electron` in test-stand mode:

```bash
cd ../gitlab/core-platform-electron
./node_modules/.bin/electron build/all/main.js -- \
  --data-dir=./3NWeb-data-launcher \
  --devtools \
  --allow-multi-instances \
  --runtime-deno=~/.deno/bin/deno \
  --test-stand=../test-stand-launcher.json
```

After wallet changes, run `./build-apps.sh wallet`. Restart Electron when hidden service components need to pick up a new bundle.
