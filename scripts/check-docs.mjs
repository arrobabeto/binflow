import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';

const root = process.cwd();
const markdownFiles = [];

const walk = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(path);
    } else if (extname(entry.name) === '.md') {
      markdownFiles.push(path);
    }
  }
};

await walk(join(root, 'docs'));
markdownFiles.push(join(root, 'README.md'), join(root, 'AGENTS.md'));

const failures = [];
for (const file of markdownFiles) {
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1];
    if (
      target === undefined ||
      target.startsWith('#') ||
      /^[a-z]+:/i.test(target)
    ) {
      continue;
    }
    const fileTarget = decodeURIComponent(target.split('#', 1)[0] ?? '');
    if (fileTarget === '') continue;
    try {
      await access(resolve(dirname(file), fileTarget));
    } catch {
      failures.push(`${file}: ${target}`);
    }
  }
}

if (failures.length > 0) {
  console.error(`Broken documentation links:\n${failures.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`Checked ${markdownFiles.length} Markdown files.`);
}
