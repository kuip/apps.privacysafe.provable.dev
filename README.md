# apps.privacysafe.provable.dev

Shared repo for Provable apps, for the PrivacySafe secure environment (https://github.com/privacysafe).

## Install in PrivacySafe

Install from:
* kayros.app.provable.dev
* wallet.app.provable.dev

Or add the release build in your PrivacySafe app.

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
- `wallet-test-external/`

## Local Pages build

```bash
cd ./apps.privacysafe.provable.dev/kayros
npm run pack:discovery

cd ./apps.privacysafe.provable.dev/nomen
npm run pack:discovery

cd ./apps.privacysafe.provable.dev/wallet
npm run pack:discovery

cd ./apps.privacysafe.provable.dev
node scripts/build-pages-site.mjs
```

This generates:

- `build/pages/index.html`
- `build/pages/CNAME`
- `build/pages/kayros/...`
- `build/pages/nomen/...`
- `build/pages/wallet/...`

## Release model

The hosted discovery tree is versioned, for example:

- `/kayros/0.1.16/list`
- `/kayros/0.1.16/unpacked/...`

Current workflow intent:

- push to `main`: validate/build only
- tag like `kayros-v0.1.17`: publish Pages and create Kayros release assets
- tag like `nomen-v0.1.1`: publish Pages and create Nomen release assets
- tag like `wallet-v0.1.1`: publish Pages and create Wallet release assets

Recommended release flow:

```bash
cd ./apps.privacysafe.provable.dev
make publish-kayros
make publish-nomen
make publish-wallet
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
- Wallet: `wallet-vX.Y.Z`

## Publish Kayros discovery files manually

```bash
cd kayros
npm run pack:discovery

cd ..
node scripts/build-pages-site.mjs
```

This updates the hosted discovery tree under `./build/pages/kayros/`.

## Publish Wallet discovery files manually

```bash
cd wallet
npm run pack:discovery

cd ..
node scripts/build-pages-site.mjs
```

This updates the hosted discovery tree under `./build/pages/wallet/`.

## Standalone App Builds

The Makefile is the default entrypoint for local standalone app builds in this repository.

Build and stage the wallet:

```bash
make build-wallet
```

Build and stage all apps:

```bash
make build-apps
```

These commands install dependencies from checked-in lockfiles with `npm ci --ignore-scripts`, run each app's production build, and stage PrivacySafe app folders under `build/apps/`.

Current staged app folders:

- `build/apps/dev.provable.app.kayros`
- `build/apps/dev.provable.app.nomen`
- `build/apps/dev.provable.app.wallet`
- `build/apps/dev.provable.app.wallet-test-external`


### Local dev

- needs local script to copy app builds to core-platform-electron/packing/bundled-apps

```bash
cd core-platform-electron
./node_modules/.bin/electron build/all/main.js -- \
  --data-dir=./3NWeb-data-launcher \
  --devtools \
  --allow-multi-instances \
  --runtime-deno=~/.deno/bin/deno \
  --test-stand=./test-stand-launcher.json
```
