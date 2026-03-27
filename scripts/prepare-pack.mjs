import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const distDir = path.join(root, 'dist');
const packDir = path.join(root, 'pack');
const appDir = path.join(packDir, 'app');
const manifestPath = path.join(root, 'manifest.json');

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const zipName = `${manifest.appDomain}-${manifest.version}.zip`;
const zipPath = path.join(root, zipName);

await rm(packDir, { recursive: true, force: true });
await rm(zipPath, { force: true });
await mkdir(appDir, { recursive: true });
await cp(distDir, appDir, { recursive: true });
await cp(manifestPath, path.join(packDir, 'manifest.json'));
await cp(path.join(root, 'logo.svg'), path.join(appDir, 'logo.svg'));

execFileSync('zip', ['-qr', zipPath, 'manifest.json', 'app'], { cwd: packDir });
