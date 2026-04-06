#!/usr/bin/env node

import { cp, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, '..');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const args = [...argv];
  const skipBuild = args.includes('--skip-build');

  return {
    skipBuild,
    outDir: join(projectDir, 'build'),
  };
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function ensureBuild(skipBuild) {
  const distDir = join(projectDir, 'dist');
  if (!skipBuild) {
    execFileSync('npm', ['run', 'build'], {
      cwd: projectDir,
      stdio: 'inherit',
    });
  }

  if (!(await exists(distDir))) {
    fail(`Build output not found: ${distDir}`);
  }

  return distDir;
}

async function resolveIconSource(iconName) {
  const candidates = [
    join(projectDir, iconName),
    join(projectDir, 'public', iconName),
    join(projectDir, 'src', 'assets', 'images', iconName),
  ];

  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function copyIconIntoPack(iconName, appDir) {
  const iconSource = await resolveIconSource(iconName);
  if (!iconSource) {
    fail(`Icon "${iconName}" not found in project root, public/, or src/assets/images/`);
  }

  await cp(iconSource, join(appDir, iconName));
}

async function main() {
  const { skipBuild, outDir } = parseArgs(process.argv.slice(2));
  const manifestPath = join(projectDir, 'manifest.json');
  if (!(await exists(manifestPath))) {
    fail(`manifest.json not found in ${projectDir}`);
  }

  const manifest = await readJson(manifestPath);
  const { appDomain, version, icon } = manifest;

  if (!appDomain || !version) {
    fail('manifest.json must contain appDomain and version');
  }

  const distDir = await ensureBuild(skipBuild);
  const zipName = `${appDomain}-${version}.zip`;
  const zipPath = join(outDir, zipName);
  const tempRoot = await mkdtemp(join(tmpdir(), `${appDomain}-pack-`));
  const appDir = join(tempRoot, 'app');

  await mkdir(outDir, { recursive: true });
  await mkdir(appDir, { recursive: true });
  await cp(distDir, appDir, { recursive: true });
  await cp(manifestPath, join(tempRoot, 'manifest.json'));

  if (icon) {
    await copyIconIntoPack(icon, appDir);
  }

  await rm(zipPath, { force: true });
  execFileSync('zip', ['-qr', zipPath, 'manifest.json', 'app'], {
    cwd: tempRoot,
    stdio: 'inherit',
  });

  console.log(zipPath);
}

await main();
