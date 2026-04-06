#!/usr/bin/env node

import { cp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoDir = resolve(scriptDir, '..');
const buildDir = join(repoDir, 'build', 'pages');

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function landingHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Provable PrivacySafe Apps</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #081931;
        --bg2: #0f2a51;
        --panel: rgba(255, 255, 255, 0.08);
        --border: rgba(255, 255, 255, 0.14);
        --text: #eef5ff;
        --muted: #bfd0ea;
        --accent: #79b3ff;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: linear-gradient(180deg, var(--bg), var(--bg2));
        color: var(--text);
      }
      main { max-width: 920px; margin: 0 auto; padding: 48px 24px 72px; }
      h1 { margin: 0 0 12px; font-size: 40px; line-height: 1.1; }
      p { margin: 0 0 16px; color: var(--muted); line-height: 1.5; }
      .grid { display: grid; gap: 16px; margin-top: 32px; }
      .card {
        display: block;
        padding: 20px 22px;
        border: 1px solid var(--border);
        border-radius: 16px;
        background: var(--panel);
        color: inherit;
        text-decoration: none;
      }
      .card:hover { border-color: var(--accent); }
      .name { font-size: 20px; font-weight: 700; }
      .path {
        margin-top: 6px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        color: var(--accent);
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Provable PrivacySafe Apps</h1>
      <p>Static discovery host for PrivacySafe apps distributed by Provable.</p>
      <p>Each app is published under its own path and referenced from its app domain via a <code>w3n-app=...</code> DNS TXT record.</p>
      <section class="grid">
        <a class="card" href="./kayros/channels">
          <div class="name">Kayros</div>
          <div class="path">/kayros</div>
        </a>
      </section>
    </main>
  </body>
</html>
`;
}

async function main() {
  const kayrosDiscovery = join(repoDir, 'kayros', 'build', 'discovery');
  if (!(await exists(kayrosDiscovery))) {
    fail(`Kayros discovery output not found: ${kayrosDiscovery}. Run "npm run pack:discovery" in kayros/ first.`);
  }

  await rm(buildDir, { recursive: true, force: true });
  await mkdir(buildDir, { recursive: true });
  await cp(kayrosDiscovery, join(buildDir, 'kayros'), { recursive: true });
  await writeFile(join(buildDir, 'CNAME'), 'apps.privacysafe.provable.dev\n', 'utf8');
  await writeFile(join(buildDir, '.nojekyll'), '\n', 'utf8');
  await writeFile(join(buildDir, 'index.html'), landingHtml(), 'utf8');

  console.log(`Pages site generated at ${buildDir}`);
}

await main();
