#!/usr/bin/env node

import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoDir = resolve(scriptDir, '..');
const defaultApps = ['kayros', 'nomen', 'wallet', 'wallet-test-external'];

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

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')} failed in ${cwd}`);
  }
}

function parseApps(argv) {
  if (argv.length === 0 || argv.includes('all')) {
    return defaultApps;
  }
  return argv;
}

function stagedAppDir(appDomain) {
  return join(repoDir, 'build', 'apps', appDomain.split('.').reverse().join('.'));
}

async function resolveIconSource(appDir, iconName) {
  const candidates = [
    join(appDir, iconName),
    join(appDir, 'public', iconName),
    join(appDir, 'src', 'assets', 'images', iconName),
  ];

  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

async function buildApp(appName) {
  const appDir = join(repoDir, appName);
  const manifestPath = join(appDir, 'manifest.json');
  const packagePath = join(appDir, 'package.json');
  const packageLockPath = join(appDir, 'package-lock.json');

  if (!(await exists(manifestPath))) {
    fail(`Unknown app or missing manifest: ${appName}`);
  }
  if (!(await exists(packagePath))) {
    fail(`Missing package.json for ${appName}`);
  }

  const manifest = await readJson(manifestPath);
  if (!manifest.appDomain) {
    fail(`manifest.json for ${appName} must include appDomain`);
  }

  console.log(`==> Building ${appName}`);
  if (await exists(packageLockPath)) {
    run('npm', ['ci', '--ignore-scripts'], appDir);
  } else {
    run('npm', ['install', '--ignore-scripts'], appDir);
  }
  run('npm', ['run', 'build'], appDir);

  const distDir = join(appDir, 'dist');
  if (!(await exists(distDir))) {
    fail(`Build output not found for ${appName}: ${distDir}`);
  }

  const targetDir = stagedAppDir(manifest.appDomain);
  const targetAppDir = join(targetDir, 'app');
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetAppDir, { recursive: true });
  await cp(distDir, targetAppDir, { recursive: true });
  await cp(manifestPath, join(targetDir, 'manifest.json'));

  if (manifest.icon) {
    const iconSource = await resolveIconSource(appDir, manifest.icon);
    if (iconSource) {
      await cp(iconSource, join(targetAppDir, manifest.icon));
    } else {
      console.warn(`Icon "${manifest.icon}" not found for ${appName}; continuing without explicit icon copy`);
    }
  }

  console.log(`==> Staged ${appName} at ${targetDir}`);
}

for (const appName of parseApps(process.argv.slice(2))) {
  await buildApp(appName);
}
