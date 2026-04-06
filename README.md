# apps.privacysafe.provable.dev

Shared repo for Provable PrivacySafe apps.

This repository has two roles:

1. source tree for individual apps stored under subfolders, starting with `kayros/`
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

## Local Pages build

The live Pages site is built from app sources. It is not committed directly under `/kayros`, because that path is already used by the Kayros app source tree.

To build the Pages artifact locally:

```bash
cd ./apps.privacysafe.provable.dev/kayros
npm run pack:discovery

cd ./apps.privacysafe.provable.dev
node scripts/build-pages-site.mjs
```

This generates:

- `build/pages/index.html`
- `build/pages/CNAME`
- `build/pages/kayros/...`

## Publish Kayros discovery files manually

```bash
cd kayros
npm run pack:discovery

cd ..
node scripts/build-pages-site.mjs
```

This updates the hosted discovery tree under `./build/pages/kayros/`.
