import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const lockfile = await readFile(`${root}/pnpm-lock.yaml`, 'utf8');

const importers = new Set();
let inImporters = false;
for (const line of lockfile.split('\n')) {
  if (line === 'importers:') {
    inImporters = true;
    continue;
  }
  if (!inImporters) continue;
  if (/^\S/.test(line)) break;

  const match = /^  ([^ ].*?):(?: \{\})?$/.exec(line);
  const importer = match?.[1]?.replace(/^['"]|['"]$/g, '');
  if (importer?.startsWith('apps/') || importer?.startsWith('packages/')) {
    importers.add(importer);
  }
}

const { stdout } = await execFileAsync(
  'git',
  [
    'ls-files',
    '-z',
    '--',
    ':(glob)apps/*/package.json',
    ':(glob)packages/*/package.json',
  ],
  { cwd: root, encoding: 'utf8' },
);
const tracked = new Set(
  stdout
    .split('\0')
    .filter(Boolean)
    .map((manifest) => dirname(manifest)),
);

const missingManifests = [...importers].filter((path) => !tracked.has(path));
const missingImporters = [...tracked].filter((path) => !importers.has(path));

if (missingManifests.length > 0 || missingImporters.length > 0) {
  if (missingManifests.length > 0) {
    console.error(
      `Lockfile workspaces missing tracked manifests:\n${missingManifests.join('\n')}`,
    );
  }
  if (missingImporters.length > 0) {
    console.error(
      `Tracked workspaces missing lockfile importers:\n${missingImporters.join('\n')}`,
    );
  }
  process.exitCode = 1;
} else {
  console.log(`Checked ${tracked.size} tracked workspace manifests.`);
}
