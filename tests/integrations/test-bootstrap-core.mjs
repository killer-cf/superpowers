import assert from 'node:assert/strict';
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';

import { createBootstrapController } from '../../integrations/shared/bootstrap.ts';

const fixtureBody =
  "---\nname: using-superpowers\ndescription: fixture\n---\n# Bootstrap body\n\nFollow the fixture skill.\n";
const marker = 'superpowers:using-superpowers bootstrap for test-harness';

async function makeFixture({ reportDiagnostic, missing = false, relativePath = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'bootstrap-controller-'));
  const absolutePath = join(directory, 'SKILL.md');
  if (!missing) await writeFile(absolutePath, fixtureBody, 'utf8');
  const bootstrapSkillPath = relativePath ? relative(process.cwd(), absolutePath) : absolutePath;
  const controller = createBootstrapController({
    harness: 'Test Harness',
    bootstrapSkillPath,
    bootstrapMarker: marker,
    loadedMessage: 'The bootstrap is already loaded for this Test Harness session. Follow it now.',
    toolMapping: '## Test Harness tool mapping\n\nUse native test tools.',
    reportDiagnostic,
  });
  return {
    controller,
    absolutePath,
    bootstrapSkillPath,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

function textOf(message) {
  return message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

test('arm injects one wrapped user message, strips frontmatter, and caches successful content', async () => {
  const fixture = await makeFixture();
  try {
    const original = { role: 'user', content: 'Continue the task', timestamp: 1 };
    const originalMessages = [original];

    assert.equal(fixture.controller.inject(originalMessages), undefined);

    fixture.controller.arm();
    const before = Date.now();
    const first = fixture.controller.inject(originalMessages);
    const after = Date.now();

    assert.ok(first);
    assert.notEqual(first.messages, originalMessages);
    assert.equal(first.messages.length, 2);
    assert.equal(first.messages[1], original);
    assert.deepEqual(originalMessages, [original]);

    const bootstrapMessage = first.messages[0];
    assert.equal(bootstrapMessage.role, 'user');
    assert.ok(bootstrapMessage.timestamp >= before);
    assert.ok(bootstrapMessage.timestamp <= after);
    assert.equal(bootstrapMessage.content.length, 1);
    assert.equal(bootstrapMessage.content[0].type, 'text');

    const bootstrapText = textOf(bootstrapMessage);
    assert.match(bootstrapText, /^<EXTREMELY_IMPORTANT>\n/);
    assert.match(bootstrapText, new RegExp(marker));
    assert.match(bootstrapText, /You have superpowers\./);
    assert.match(bootstrapText, /# Bootstrap body\n\nFollow the fixture skill\./);
    assert.match(bootstrapText, /## Test Harness tool mapping\n\nUse native test tools\./);
    assert.match(bootstrapText, /<\/EXTREMELY_IMPORTANT>$/);
    assert.doesNotMatch(bootstrapText, /name: using-superpowers/);
    assert.doesNotMatch(bootstrapText, /description: fixture/);

    await unlink(fixture.absolutePath);
    fixture.controller.disarm();
    fixture.controller.arm();
    const second = fixture.controller.inject(originalMessages);
    assert.ok(second);
    assert.equal(textOf(second.messages[0]), bootstrapText);
    assert.equal(second.messages[1], original);
  } finally {
    await fixture.cleanup();
  }
});

test('existing markers in string or multipart text content suppress injection', async () => {
  const fixture = await makeFixture();
  try {
    fixture.controller.arm();

    const stringMessage = { role: 'user', content: `Already loaded: ${marker}` };
    assert.equal(fixture.controller.inject([stringMessage]), undefined);

    const multipartMessage = {
      role: 'assistant',
      content: [
        { type: 'text', text: `Earlier bootstrap: ${marker}` },
        { type: 'image', data: marker },
      ],
    };
    assert.equal(fixture.controller.inject([multipartMessage]), undefined);

    const imageOnlyMessage = {
      role: 'user',
      content: [{ type: 'image', data: marker }],
    };
    const imageResult = fixture.controller.inject([imageOnlyMessage]);
    assert.ok(imageResult);
    assert.equal(imageResult.messages[1], imageOnlyMessage);
  } finally {
    await fixture.cleanup();
  }
});

test('injection follows all leading compaction summaries and preserves message order and identity', async () => {
  const fixture = await makeFixture();
  try {
    fixture.controller.arm();
    const firstSummary = { role: 'compactionSummary', summary: 'First summary' };
    const secondSummary = { role: 'compactionSummary', summary: 'Second summary' };
    const user = { role: 'user', content: 'Continue' };
    const trailingSummary = { role: 'compactionSummary', summary: 'Trailing summary' };
    const messages = [firstSummary, secondSummary, user, trailingSummary];

    const result = fixture.controller.inject(messages);

    assert.ok(result);
    assert.equal(result.messages.length, 5);
    assert.equal(result.messages[0], firstSummary);
    assert.equal(result.messages[1], secondSummary);
    assert.equal(result.messages[2].role, 'user');
    assert.match(textOf(result.messages[2]), /You have superpowers\./);
    assert.equal(result.messages[3], user);
    assert.equal(result.messages[4], trailingSummary);
    assert.deepEqual(messages, [firstSummary, secondSummary, user, trailingSummary]);
  } finally {
    await fixture.cleanup();
  }
});

test('read failure fails soft and reports one structured diagnostic without retrying', async () => {
  const diagnostics = [];
  const fixture = await makeFixture({
    missing: true,
    relativePath: true,
    reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  try {
    fixture.controller.arm();

    assert.equal(fixture.controller.inject([]), undefined);
    assert.equal(diagnostics.length, 1);
    assert.deepEqual(diagnostics[0], {
      level: 'warning',
      code: 'bootstrap-read-failed',
      harness: 'Test Harness',
      path: resolve(fixture.bootstrapSkillPath),
      error: diagnostics[0].error,
    });
    assert.match(diagnostics[0].error, /ENOENT/);

    await writeFile(fixture.absolutePath, fixtureBody, 'utf8');
    assert.equal(fixture.controller.inject([]), undefined);
    assert.equal(diagnostics.length, 1);
  } finally {
    await fixture.cleanup();
  }
});

test('throwing diagnostic callback does not escape injection or cause a retry', async () => {
  let callbackCalls = 0;
  const fixture = await makeFixture({
    missing: true,
    reportDiagnostic: () => {
      callbackCalls += 1;
      throw new Error('diagnostic sink failed');
    },
  });
  try {
    fixture.controller.arm();

    assert.equal(fixture.controller.inject([]), undefined);
    assert.equal(fixture.controller.inject([]), undefined);
    assert.equal(callbackCalls, 1);
  } finally {
    await fixture.cleanup();
  }
});
