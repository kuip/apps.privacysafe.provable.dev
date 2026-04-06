# Kayros PrivacySafe App

This repository scaffolds a PrivacySafe subapp for Kayros notarization.

It contains:

- a launcher UI at `/index.html`
- a web-gui service component at `/service.html`
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

## Important runtime note

This prototype uses a web-gui service component instead of a Deno service component, because the current platform host starts Deno components without general outbound network access, which prevents direct calls to the Kayros API.
