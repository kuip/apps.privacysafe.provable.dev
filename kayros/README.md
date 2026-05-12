# Kayros PrivacySafe App

This repository scaffolds a PrivacySafe subapp for Kayros cryptographic integrity proofs for files and data.

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
