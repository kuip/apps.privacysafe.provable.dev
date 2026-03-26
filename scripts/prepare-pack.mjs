import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const distDir = path.join(root, 'dist');
const appDir = path.join(root, 'app');

await rm(appDir, { recursive: true, force: true });
await mkdir(appDir, { recursive: true });
await cp(distDir, appDir, { recursive: true });
await cp(path.join(root, 'manifest.json'), path.join(appDir, 'manifest.json'));
await cp(path.join(root, 'logo.svg'), path.join(appDir, 'logo.svg'));
