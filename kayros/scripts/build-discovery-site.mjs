#!/usr/bin/env node

import { cp, mkdir, readFile, rm, stat, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, '..');
const DEFAULT_CHANNEL = 'public';
const UNPACKED_DIR_NAME = 'unpacked';

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const args = [...argv];
  return {
    skipBuild: args.includes('--skip-build'),
    outDir: join(projectDir, 'build', 'discovery'),
    channel: DEFAULT_CHANNEL,
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

async function ensureZipArtifact(version) {
  const zipName = `kayros.app.provable.dev-${version}.zip`;
  const zipPath = join(projectDir, 'build', zipName);

  if (!(await exists(zipPath))) {
    execFileSync('node', ['scripts/pack-app.mjs', '--skip-build'], {
      cwd: projectDir,
      stdio: 'inherit',
    });
  }

  if (!(await exists(zipPath))) {
    fail(`Pack artifact not found: ${zipPath}`);
  }

  return { zipName, zipPath };
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

async function listFilesRecursive(rootDir) {
  const out = [];

  async function visit(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else {
        out.push(fullPath);
      }
    }
  }

  await visit(rootDir);
  return out;
}

function sha512Base64(buffer) {
  return createHash('sha512').update(buffer).digest('base64');
}

async function buildContentIndex(unpackedRoot) {
  const files = await listFilesRecursive(unpackedRoot);
  const content = [];

  for (const fullPath of files) {
    const relPath = relative(unpackedRoot, fullPath).split('\\').join('/');
    if (relPath === 'content.json') {
      continue;
    }

    const bytes = await readFile(fullPath);
    content.push({
      file: relPath,
      sha512: sha512Base64(bytes),
      size: bytes.byteLength,
    });
  }

  return { content };
}

async function main() {
  const { skipBuild, outDir, channel } = parseArgs(process.argv.slice(2));
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
  const { zipName, zipPath } = await ensureZipArtifact(version);
  const versionDir = join(outDir, version);
  const unpackedDir = join(versionDir, UNPACKED_DIR_NAME);
  const appDir = join(unpackedDir, 'app');

  await rm(outDir, { recursive: true, force: true });
  await mkdir(appDir, { recursive: true });
  await cp(distDir, appDir, { recursive: true });
  await cp(manifestPath, join(unpackedDir, 'manifest.json'));

  if (icon) {
    const iconSource = await resolveIconSource(icon);
    if (iconSource) {
      await cp(iconSource, join(appDir, icon));
    } else {
      console.warn(`Icon "${icon}" not found in project root, public/, or src/assets/images/; skipping icon copy`);
    }
  }

  const contentIndex = await buildContentIndex(unpackedDir);
  await writeFile(
    join(unpackedDir, 'content.json'),
    `${JSON.stringify(contentIndex, null, 2)}\n`,
    'utf8',
  );

  const zipBytes = await readFile(zipPath);
  await cp(zipPath, join(versionDir, zipName));

  const versionList = {
    files: {
      [zipName]: {
        content: 'bin/zip',
        sha512: sha512Base64(zipBytes),
        size: zipBytes.byteLength,
      },
      [UNPACKED_DIR_NAME]: {
        content: 'bin/unpacked',
        sha512: '',
        size: 0,
      },
    },
  };

  const channels = {
    channels: {
      [channel]: {
        description: 'Public releases',
        usage: 'public',
      },
    },
    main: channel,
  };

  await mkdir(versionDir, { recursive: true });
  await writeFile(join(outDir, 'channels'), `${JSON.stringify(channels, null, 2)}\n`, 'utf8');
  await writeFile(join(outDir, `${channel}.latest`), `${JSON.stringify(version)}\n`, 'utf8');
  await writeFile(join(outDir, `${channel}.list`), `${JSON.stringify([version], null, 2)}\n`, 'utf8');
  await writeFile(join(versionDir, 'list'), `${JSON.stringify(versionList, null, 2)}\n`, 'utf8');

  console.log(`Discovery site generated at ${outDir}`);
  console.log(`Base URL path should serve files from this directory.`);
  console.log(`DNS TXT for ${appDomain}: w3n-app=<host>/<optional-path>`);
}

await main();
