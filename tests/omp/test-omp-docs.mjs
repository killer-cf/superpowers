import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');

async function readRepoFile(relativePath) {
  return readFile(resolve(repoRoot, relativePath), 'utf8');
}

test('README documents the native OMP installation path', async () => {
  const readme = await readRepoFile('README.md');
  const piHeading = readme.indexOf('### Pi');
  const ompHeading = readme.indexOf('### Oh My Pi (OMP)');

  assert.match(readme, /\[Oh My Pi \(OMP\)\]\(#oh-my-pi-omp\)/);
  assert.ok(piHeading >= 0, 'README should retain the Pi installation section');
  assert.ok(ompHeading > piHeading, 'OMP should follow the Pi installation section');
  assert.match(readme, /omp plugin install github:obra\/superpowers/);
  assert.match(readme, /omp plugin link \/absolute\/path\/to\/superpowers/);
  assert.match(readme, /\.omp\/INSTALL\.md/);
  assert.match(readme, /native manifest[\s\S]*lowercase `task` and `todo`/i);
});

test('OMP install guide documents install, diagnostics, and removal commands', async () => {
  const guide = await readRepoFile('.omp/INSTALL.md');

  for (const heading of [
    '## Prerequisite',
    '## Install from git',
    '## Local development',
    '## Verify',
    '## Remove',
  ]) {
    assert.match(guide, new RegExp(`^${heading}$`, 'm'));
  }

  for (const command of [
    'omp plugin install github:obra/superpowers',
    'omp plugin link /absolute/path/to/superpowers',
    'omp plugin list --json',
    'omp plugin list',
    'omp plugin uninstall superpowers',
  ]) {
    assert.match(guide, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.match(guide, /~\/.omp\/logs\//);
  assert.match(guide, /> Let's make a react todo list/);
});

test('OMP install guide records verification without asserting a version floor', async () => {
  const guide = await readRepoFile('.omp/INSTALL.md');

  assert.match(guide, /verified with OMP `?18\.1\.18`?/i);
  for (const forbidden of [
    /OMP\s*>=\s*18\.1\.18/i,
    /18\.1\.18\+/i,
    /18\.1\.18\s+(?:or newer|or later|and above)/i,
    /OMP[^\n]*(?:minimum|at least)[^\n]*18\.1\.18/i,
  ]) {
    assert.doesNotMatch(guide, forbidden);
  }
});

test('OMP install guide explains bootstrap triggering without marketplace claims', async () => {
  const guide = await readRepoFile('.omp/INSTALL.md');

  assert.match(guide, /brainstorming[\s\S]*auto-triggers[\s\S]*before code/i);
  assert.doesNotMatch(guide, /marketplace[\s\S]*omp\.extensions/i);
});
