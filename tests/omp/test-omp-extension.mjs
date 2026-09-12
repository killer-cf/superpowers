import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const packageJsonPath = resolve(repoRoot, 'package.json');
const extensionPath = resolve(repoRoot, '.omp/extensions/superpowers.ts');
const bootstrapSkillPath = resolve(repoRoot, 'skills/using-superpowers/SKILL.md');
const bootstrapMarker = 'superpowers:using-superpowers bootstrap for omp';

async function readPackageJson() {
  return JSON.parse(await readFile(packageJsonPath, 'utf8'));
}

function makeFakeOmp() {
  const handlers = new Map();
  const warnings = [];
  const invocations = [];
  const omp = {
    logger: {
      warn(...args) {
        warnings.push(args);
      },
    },
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(handler);
    },
  };

  return {
    omp,
    handlers,
    warnings,
    invocations,
    async invoke(event, ...args) {
      const eventHandlers = handlers.get(event) ?? [];
      invocations.push(event);
      assert.equal(eventHandlers.length, 1, `expected one ${event} handler`);
      return eventHandlers[0](...args);
    },
  };
}

async function loadExtension(extension = extensionPath) {
  const host = makeFakeOmp();
  const mod = await import(pathToFileURL(extension).href + `?cachebust=${Date.now()}-${Math.random()}`);
  mod.default(host.omp);
  return host;
}

function firstHandler(handlers, event) {
  const eventHandlers = handlers.get(event) ?? [];
  assert.equal(eventHandlers.length, 1, `expected one ${event} handler`);
  return eventHandlers[0];
}

function textOf(message) {
  if (typeof message.content === 'string') return message.content;
  return message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

test('package.json declares exact Pi and native OMP extension manifests', async () => {
  const pkg = await readPackageJson();

  assert.deepEqual(pkg.omp, {
    extensions: ['./.omp/extensions/superpowers.ts'],
  });
  assert.deepEqual(pkg.pi, {
    extensions: ['./.pi/extensions/superpowers.ts'],
    skills: ['./skills'],
  });
});

test('OMP factory registers exactly the live lifecycle hooks and runs none during loading', async () => {
  const host = await loadExtension();

  assert.deepEqual([...host.handlers.keys()], [
    'session_start',
    'session_compact',
    'context',
    'agent_end',
  ]);
  for (const event of ['session_start', 'session_compact', 'context', 'agent_end']) {
    assert.equal(host.handlers.get(event).length, 1, `expected one ${event} handler`);
  }
  assert.equal(host.handlers.has('resources_discover'), false);
  assert.equal(host.handlers.has('session_before_compact'), false);
  assert.deepEqual(host.invocations, []);
});

test('OMP relies on the package-root skills convention rather than resource discovery', async () => {
  const host = await loadExtension();
  const skill = await readFile(bootstrapSkillPath, 'utf8');
  const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/);

  assert.equal(host.handlers.has('resources_discover'), false);
  assert.equal(existsSync(resolve(repoRoot, 'skills')), true);
  assert.ok(frontmatter, 'using-superpowers skill should have frontmatter');
  assert.match(frontmatter[1], /^name:\s*using-superpowers\s*$/m);
  assert.match(frontmatter[1], /^description:\s*\S.+$/m);
});

test('session_start injects the OMP bootstrap with native mapping', async () => {
  const host = await loadExtension();
  const context = firstHandler(host.handlers, 'context');

  const messages = [{ role: 'user', content: [{ type: 'text', text: 'Let us make a react todo list' }], timestamp: 1 }];
  assert.equal(await context({ type: 'context', messages }, {}), undefined);

  await host.invoke('session_start', { type: 'session_start', reason: 'startup' }, {});
  const result = await host.invoke('context', { type: 'context', messages }, {});

  assert.ok(result);
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[1], messages[0]);
  const bootstrapText = textOf(result.messages[0]);
  assert.match(bootstrapText, /superpowers:using-superpowers bootstrap for omp/);
  assert.match(bootstrapText, /skill:\/\/\<name\>\/SKILL\.md/);
  for (const tool of ['read', 'write', 'edit', 'bash', 'grep', 'glob']) {
    assert.match(bootstrapText, new RegExp('`' + tool + '`'));
  }
  assert.match(bootstrapText, /lowercase `task`/);
  assert.match(bootstrapText, /lowercase `todo`/);
  assert.match(bootstrapText, /never invent capitalized `Skill`, `Task`, or `TodoWrite` calls/i);
  assert.doesNotMatch(bootstrapText, /Pi tool mapping/);
  assert.doesNotMatch(bootstrapText, /pi-subagents/);
});

test('OMP bootstrap deduplicates markers and disarms after agent_end', async () => {
  const host = await loadExtension();
  const context = firstHandler(host.handlers, 'context');
  const messages = [{ role: 'user', content: [{ type: 'text', text: 'Continue' }], timestamp: 1 }];

  await host.invoke('session_start', { type: 'session_start', reason: 'startup' }, {});
  const result = await host.invoke('context', { type: 'context', messages }, {});
  assert.ok(result);

  const duplicate = await host.invoke('context', { type: 'context', messages: result.messages }, {});
  assert.equal(duplicate, undefined);

  const stringMarker = await host.invoke('context', {
    type: 'context',
    messages: [{ role: 'user', content: `Already loaded: ${bootstrapMarker}` }],
  }, {});
  assert.equal(stringMarker, undefined);

  const multipartMarker = await host.invoke('context', {
    type: 'context',
    messages: [{ role: 'assistant', content: [{ type: 'text', text: `Already loaded: ${bootstrapMarker}` }] }],
  }, {});
  assert.equal(multipartMarker, undefined);

  await host.invoke('agent_end', { type: 'agent_end', messages: [] }, {});
  const afterEnd = await host.invoke('context', { type: 'context', messages }, {});
  assert.equal(afterEnd, undefined);
});

test('session_compact re-arms injection after all leading compaction summaries', async () => {
  const host = await loadExtension();
  const firstSummary = { role: 'compactionSummary', summary: 'Prior work summary', timestamp: 1 };
  const secondSummary = { role: 'compactionSummary', summary: 'Latest work summary', timestamp: 2 };
  const user = { role: 'user', content: [{ type: 'text', text: 'Continue' }], timestamp: 3 };

  await host.invoke('session_compact', { type: 'session_compact', compactionEntry: {}, fromExtension: false }, {});
  const result = await host.invoke('context', {
    type: 'context',
    messages: [firstSummary, secondSummary, user],
  }, {});

  assert.ok(result);
  assert.equal(result.messages.length, 4);
  assert.equal(result.messages[0], firstSummary);
  assert.equal(result.messages[1], secondSummary);
  assert.equal(result.messages[2].role, 'user');
  assert.match(textOf(result.messages[2]), /You have superpowers/);
  assert.equal(result.messages[3], user);
});

test('OMP logger reports one cached bootstrap-read warning when package skills are missing', async () => {
  const tempRoot = await mkdtemp(resolve(tmpdir(), 'superpowers-omp-'));
  const tempExtensionDir = resolve(tempRoot, '.omp/extensions');
  const tempSharedDir = resolve(tempRoot, 'integrations/shared');
  const tempExtensionPath = resolve(tempExtensionDir, 'superpowers.ts');
  try {
    await mkdir(tempExtensionDir, { recursive: true });
    await mkdir(tempSharedDir, { recursive: true });
    await copyFile(extensionPath, tempExtensionPath);
    await copyFile(resolve(repoRoot, 'integrations/shared/bootstrap.ts'), resolve(tempSharedDir, 'bootstrap.ts'));

    const host = await loadExtension(tempExtensionPath);
    await host.invoke('session_start', { type: 'session_start', reason: 'startup' }, {});
    const messages = [{ role: 'user', content: [{ type: 'text', text: 'Continue' }], timestamp: 1 }];
    assert.equal(await host.invoke('context', { type: 'context', messages }, {}), undefined);
    assert.equal(await host.invoke('context', { type: 'context', messages }, {}), undefined);

    assert.equal(host.warnings.length, 1);
    assert.equal(host.warnings[0].length, 2);
    assert.equal(host.warnings[0][0], 'Superpowers bootstrap unavailable');
    assert.equal(host.warnings[0][1].code, 'bootstrap-read-failed');
    assert.equal(host.warnings[0][1].harness, 'omp');
    assert.equal(host.warnings[0][1].path, resolve(tempRoot, 'skills/using-superpowers/SKILL.md'));
    assert.match(host.warnings[0][1].error, /ENOENT/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
