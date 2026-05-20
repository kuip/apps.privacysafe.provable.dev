# Kayros App for PrivacySafe

This repository scaffolds an app for Kayros cryptographic integrity proofs for files and data, that works in the PrivacySafe environment (https://github.com/PrivacySafe/privacysafe-platform-electron).

Features:
- register data integrity proofs for arbitrary data with Kayros indexers (https://provable.dev)
- store Merkle proofs & manage them (sync, verify)
- automatically register an integrity proof for uploaded files in the Storage app (works with this fork: https://github.com/kuip/files.app.privacysafe.io/tree/kayros-changes)

## DEMOs

- https://youtu.be/2x3JgpubZ30

It contains:

- a launcher UI at `/index.html`
- a Deno service component at `/service.js`
- an RPC service named `KayrosNotary`

The UI talks to the service through `w3n.rpc.thisApp`, and other apps can talk to the same service through `w3n.rpc.otherAppsRPC` once they request the appropriate manifest capability.

## Local build

```bash
npm install
npm run build
```

The installable pack is written to `app/`.

## Current scope

The service currently exposes:

- `getSettings`
- `saveSettings`
- `registerHash`
- `lookupRecord`

Settings are persisted in this app's local PrivacySafe storage as `settings.json`.

## Runtime note

The service runs as a Deno component and calls the Kayros API through the app manifest's `connectToExternal.fetch` capability.
