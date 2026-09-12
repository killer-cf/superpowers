# Native Oh My Pi Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class Oh My Pi extension that discovers bundled Superpowers skills and injects the bootstrap on startup and after compaction while retaining Pi behavior.

**Architecture:** A new SDK-neutral bootstrap controller owns message construction, caching, de-duplication, lifecycle state, compaction placement, and fail-soft diagnostics. Thin Pi and OMP adapters own their host APIs and tool mappings. OMP is loaded through `package.json#omp.extensions` and uses its native package-root skill discovery; Pi retains `resources_discover`.

**Tech Stack:** TypeScript extension modules loaded by Pi/OMP, Node built-in test runner with `--experimental-strip-types`, root `package.json` manifests, OMP CLI 18.1.18.

**Spec:** `docs/superpowers/specs/2026-09-12-omp-native-extension-design.md`

## Global Constraints

- Do not modify `skills/**` or add runtime dependencies.
- Verify OMP behavior on `omp/18.1.18`; do not present that version as a compatibility floor.
- OMP must load through `package.json#omp.extensions`, not by reusing the Pi adapter or `resources_discover`.
- Preserve Pi's `resources_discover` hook, Pi manifest, existing lifecycle behavior, and Pi-specific mapping.
- Use lowercase OMP `task` and `todo`; do not tell models to invent capitalized `Skill`, `Task`, or `TodoWrite` calls.
- Documentation must not claim marketplace installations cannot load extension modules; that behavior differs across OMP releases.
- Every new permanent test must defend an observable contract. The real OMP acceptance session is a smoke test, not a permanent mocked test.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `integrations/shared/bootstrap.ts` | SDK-independent bootstrap state, message construction, marker scanning, frontmatter stripping, cache, and one-shot diagnostics. |
| `.pi/extensions/superpowers.ts` | Pi-specific resource discovery, lifecycle registration, Pi mapping, and diagnostic sink. |
| `.omp/extensions/superpowers.ts` | OMP-specific lifecycle registration, OMP mapping, native OMP types, and logger diagnostic sink. |
| `package.json` | Pi manifest retained; OMP extension entry added. |
| `tests/integrations/test-bootstrap-core.mjs` | Direct contracts for the shared controller. |
| `tests/pi/test-pi-extension.mjs` | Pi manifest/discovery/lifecycle regressions after the refactor. |
| `tests/omp/test-omp-extension.mjs` | OMP manifest, host-boundary, lifecycle, mapping, and fail-soft contracts. |
| `tests/omp/test-omp-docs.mjs` | Install/verification documentation contracts. |
| `.omp/INSTALL.md` | OMP install, local link, verification, diagnostics, and removal instructions. |
| `README.md` | Short OMP installation section next to the Pi section. |

## Task 1: Shared bootstrap controller

**Files:**
- Create: `integrations/shared/bootstrap.ts`
- Create: `tests/integrations/test-bootstrap-core.mjs`

**Interfaces:**
- Consumes: a harness name, absolute or relative `bootstrapSkillPath`, unique marker, loaded-message text, tool mapping, and optional diagnostic callback.
- Produces: `createBootstrapController<Message>(config): BootstrapController<Message>` for both adapters.

```ts
export interface BootstrapDiagnostic {
  level: "warning";
  code: "bootstrap-read-failed";
  harness: string;
  path: string;
  error: string;
}

export interface BootstrapControllerConfig {
  harness: string;
  bootstrapSkillPath: string;
  bootstrapMarker: string;
  loadedMessage: string;
  toolMapping: string;
  reportDiagnostic?: (diagnostic: BootstrapDiagnostic) => void;
}

export interface BootstrapController<Message = unknown> {
  arm(): void;
  disarm(): void;
  inject(messages: Message[]): { messages: Message[] } | undefined;
}

export function createBootstrapController<Message = unknown>(
  config: BootstrapControllerConfig,
): BootstrapController<Message>;
```

- [ ] **Step 1: Write the failing controller tests**

Create `tests/integrations/test-bootstrap-core.mjs`. Use a temporary `SKILL.md` with this exact fixture body:

```js
"---\nname: using-superpowers\ndescription: fixture\n---\n# Bootstrap body\n\nFollow the fixture skill.\n"
```

Create a fixture helper that returns a controller with:

```js
const marker = "superpowers:using-superpowers bootstrap for test-harness";
createBootstrapController({
  harness: "Test Harness",
  bootstrapSkillPath,
  bootstrapMarker: marker,
  loadedMessage: "The bootstrap is already loaded for this Test Harness session. Follow it now.",
  toolMapping: "## Test Harness tool mapping\n\nUse native test tools.",
});
```

Add these five contract tests:

1. `arm injects one wrapped user message, strips frontmatter, and caches successful content` — prove a disarmed controller returns `undefined`; an armed controller returns a new two-message array; it preserves the original message object; the inserted multipart user message contains `<EXTREMELY_IMPORTANT>`, the marker, `You have superpowers.`, fixture body, mapping, and closing marker; it omits the YAML fields. Delete the fixture after first injection, re-arm, and prove cached text still injects.
2. `existing markers in string or multipart text content suppress injection` — prove a string message and a multipart text part with the marker both return `undefined`.
3. `injection follows all leading compaction summaries and preserves message order and identity` — use two leading `compactionSummary` objects, then a user object and trailing summary; assert injection is at index 2 and the input array is unchanged.
4. `read failure fails soft and reports one structured diagnostic without retrying` — use a missing path, assert one warning has `level: "warning"`, `code: "bootstrap-read-failed"`, the harness value, `resolve(configuredPath)`, and an `ENOENT` error. Create the file afterward and prove it is still not reread.
5. `throwing diagnostic callback does not escape injection or cause a retry` — remove the fixture, use a callback that increments then throws, and assert two calls to `inject([])` both return `undefined` while the callback ran once.

- [ ] **Step 2: Run the controller test to verify RED**

Run:

```bash
node --experimental-strip-types --test tests/integrations/test-bootstrap-core.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `integrations/shared/bootstrap.ts`.

- [ ] **Step 3: Implement the controller**

Create `integrations/shared/bootstrap.ts`. Use `readFileSync` from `node:fs` and `resolve` from `node:path`. The implementation must follow this shape:

```ts
const bootstrapSkillPath = resolve(config.bootstrapSkillPath);
let armed = false;
let cachedBootstrap: string | null | undefined;

function getBootstrap(): string | null {
  if (cachedBootstrap !== undefined) return cachedBootstrap;
  try {
    const body = stripFrontmatter(readFileSync(bootstrapSkillPath, "utf8"));
    cachedBootstrap = `<EXTREMELY_IMPORTANT>\n${config.bootstrapMarker}\n\nYou have superpowers.\n\n${config.loadedMessage}\n\n${body}\n\n${config.toolMapping}\n</EXTREMELY_IMPORTANT>`;
    return cachedBootstrap;
  } catch (error) {
    cachedBootstrap = null;
    try {
      config.reportDiagnostic?.({
        level: "warning",
        code: "bootstrap-read-failed",
        harness: config.harness,
        path: bootstrapSkillPath,
        error: error instanceof Error ? error.message : String(error),
      });
    } catch {}
    return null;
  }
}
```

Implement `inject` so it returns `undefined` if not armed or if any input message contains `config.bootstrapMarker`. Otherwise get the cached bootstrap; if it is `null`, return `undefined`; build one user-role multipart text message with `Date.now()` timestamp; and return a new array that inserts it after all leading records whose `role` is exactly `"compactionSummary"`.

Use these private helpers:

```ts
function stripFrontmatter(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return (match ? match[1] : content).trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
```

The marker predicate must inspect string `content` and multipart components with `{ type: "text", text: string }`; image data must not count as a marker.

- [ ] **Step 4: Run the controller test to verify GREEN**

Run:

```bash
node --experimental-strip-types --test tests/integrations/test-bootstrap-core.mjs
```

Expected: 5 passing tests and zero failures.

- [ ] **Step 5: Commit the shared controller**

```bash
git add integrations/shared/bootstrap.ts tests/integrations/test-bootstrap-core.mjs
git commit -m "refactor: share harness bootstrap controller"
```

## Task 2: Preserve Pi through the shared controller

**Files:**
- Modify: `.pi/extensions/superpowers.ts`
- Modify: `tests/pi/test-pi-extension.mjs`

**Interfaces:**
- Consumes: `createBootstrapController<ContextEvent["messages"][number]>` from Task 1.
- Produces: the existing Pi extension contract: `resources_discover`, `session_start`, `session_compact`, `context`, and `agent_end` handlers.

- [ ] **Step 1: Add failing Pi refactor tests**

In `tests/pi/test-pi-extension.mjs`, add a source-boundary test:

```js
test("pi adapter depends on shared core, never the OMP adapter", async () => {
  const source = await readFile(extensionPath, "utf8");
  assert.match(
    source,
    /import \{ createBootstrapController \} from "\.\.\/\.\.\/integrations\/shared\/bootstrap\.ts"/,
  );
  assert.doesNotMatch(source, /from\s+["'][^"']*\.omp\//);
});
```

Extend the lifecycle test to assert both string and multipart bootstrap markers suppress injection. Extend the compaction test to include two leading summaries and assert the bootstrap becomes message index 2. Preserve the existing assertions for `resources_discover`, the Pi tool mapping, `agent_end`, and the Pi manifest.

Add a missing-bootstrap test that copies the Pi adapter and shared controller into a temporary package root without `skills/`, starts the fake Pi session, invokes `context` twice, and asserts both calls return `undefined` and only one `console.warn` contains a diagnostic with `code: "bootstrap-read-failed"`. Restore `console.warn` in `finally`.

- [ ] **Step 2: Run the Pi test to verify RED**

Run:

```bash
node --experimental-strip-types --test tests/pi/test-pi-extension.mjs
```

Expected: FAIL at the shared-controller import assertion because the current Pi adapter still owns the bootstrap implementation.

- [ ] **Step 3: Refactor the Pi adapter**

Replace direct bootstrap loading/caching/marker helpers in `.pi/extensions/superpowers.ts` with:

```ts
import type { ContextEvent, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBootstrapController } from "../../integrations/shared/bootstrap.ts";

const BOOTSTRAP_MARKER = "superpowers:using-superpowers bootstrap for pi";
const LOADED_MESSAGE =
  "The using-superpowers skill content is included below and is already loaded for this Pi session. Follow it now. Do not try to load using-superpowers again.";
```

Inside `superpowersPiExtension`, keep `resources_discover` exactly as the only Pi discovery hook. Instantiate the controller with Pi's marker, Pi mapping, and `bootstrapSkillPath`. Since the Pi SDK type does not require a logger, obtain it without weakening the extension API:

```ts
const logger = (
  pi as ExtensionAPI & {
    logger?: { warn?: (...args: unknown[]) => void };
  }
).logger;
```

Use this diagnostic callback:

```ts
reportDiagnostic(diagnostic) {
  if (logger?.warn) {
    logger.warn("Superpowers bootstrap unavailable", diagnostic);
  } else {
    console.warn("Superpowers bootstrap unavailable", diagnostic);
  }
}
```

Register the four existing lifecycle handlers as:

```ts
pi.on("session_start", async () => controller.arm());
pi.on("session_compact", async () => controller.arm());
pi.on("agent_end", async () => controller.disarm());
pi.on("context", async (event: ContextEvent) => controller.inject(event.messages));
```

Do not change `piToolMapping()` text. Delete the obsolete local bootstrap cache, frontmatter, marker, and compaction helper functions.

- [ ] **Step 4: Run the Pi test to verify GREEN**

Run:

```bash
node --experimental-strip-types --test tests/pi/test-pi-extension.mjs
```

Expected: all Pi tests pass, including resource discovery, duplicate suppression, two-summary placement, shared-core boundary, and one-time missing-file diagnostic.

- [ ] **Step 5: Commit the Pi-preserving refactor**

```bash
git add .pi/extensions/superpowers.ts tests/pi/test-pi-extension.mjs
git commit -m "refactor: preserve Pi bootstrap through shared controller"
```

## Task 3: Native OMP manifest and adapter

**Files:**
- Create: `.omp/extensions/superpowers.ts`
- Modify: `package.json`
- Create: `tests/omp/test-omp-extension.mjs`

**Interfaces:**
- Consumes: `createBootstrapController<ContextEvent["messages"][number]>` from Task 1 and an OMP package-root `skills/` directory.
- Produces: `superpowersOmpExtension(omp: ExtensionAPI)` loaded by `package.json#omp.extensions`.

- [ ] **Step 1: Write failing OMP extension tests**

Create `tests/omp/test-omp-extension.mjs` with a fake OMP host exposing `on(event, handler)` and `logger.warn(message, metadata)`. Import `.omp/extensions/superpowers.ts` via a cache-busted `pathToFileURL` and collect handler registrations.

Add these tests:

1. Root `package.json` has exactly:

```js
assert.deepEqual(pkg.omp, {
  extensions: ["./.omp/extensions/superpowers.ts"],
});
assert.deepEqual(pkg.pi, {
  extensions: ["./.pi/extensions/superpowers.ts"],
  skills: ["./skills"],
});
```

2. Extension source imports `ContextEvent` and `ExtensionAPI` from `@oh-my-pi/pi-coding-agent`, imports only the shared controller, and does not import `.pi` or use `console.warn`.
3. Factory registers exactly `session_start`, `session_compact`, `context`, and `agent_end`, each once; it never registers `resources_discover` or `session_before_compact`; no handler runs during factory execution.
4. The OMP host has no `resources_discover` handler, while the package contains `skills/using-superpowers/SKILL.md` with its expected frontmatter.
5. Startup starts disarmed, then injects one OMP-marked user message after `session_start`; assert OMP text contains `skill://<name>/SKILL.md`, lowercase built-ins, lowercase `task`, lowercase `todo`, and the prohibition on capitalized calls. Assert it contains neither the Pi mapping nor `pi-subagents`. Assert string and multipart markers suppress injection, and `agent_end` disarms it.
6. `session_compact` plus two leading `compactionSummary` messages inserts the bootstrap after both summaries.
7. Copy the OMP adapter and shared controller to a temporary package root with no `skills/`, run startup/context twice, and assert exactly one `omp.logger.warn("Superpowers bootstrap unavailable", diagnostic)` with a `bootstrap-read-failed` warning.

- [ ] **Step 2: Run the OMP extension test to verify RED**

Run:

```bash
node --experimental-strip-types --test tests/omp/test-omp-extension.mjs
```

Expected: FAIL because `.omp/extensions/superpowers.ts` and `package.json#omp` do not exist.

- [ ] **Step 3: Add the manifest and OMP adapter**

Add this sibling to the existing root `pi` field in `package.json`:

```json
"omp": {
  "extensions": [
    "./.omp/extensions/superpowers.ts"
  ]
}
```

Create `.omp/extensions/superpowers.ts` using this concrete structure:

```ts
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ContextEvent, ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { createBootstrapController } from "../../integrations/shared/bootstrap.ts";

const BOOTSTRAP_MARKER = "superpowers:using-superpowers bootstrap for omp";
const LOADED_MESSAGE =
  "The using-superpowers skill content is included below and is already loaded for this OMP session. Follow it now. Do not reload using-superpowers.";
const extensionDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(extensionDir, "../..");
const skillsDir = resolve(packageRoot, "skills");
const bootstrapSkillPath = resolve(skillsDir, "using-superpowers", "SKILL.md");

export default function superpowersOmpExtension(omp: ExtensionAPI) {
  const controller = createBootstrapController<ContextEvent["messages"][number]>({
    harness: "omp",
    bootstrapSkillPath,
    bootstrapMarker: BOOTSTRAP_MARKER,
    loadedMessage: LOADED_MESSAGE,
    toolMapping: ompToolMapping(),
    reportDiagnostic(diagnostic) {
      omp.logger.warn("Superpowers bootstrap unavailable", diagnostic);
    },
  });

  omp.on("session_start", async () => controller.arm());
  omp.on("session_compact", async () => controller.arm());
  omp.on("context", async (event: ContextEvent) => controller.inject(event.messages));
  omp.on("agent_end", async () => controller.disarm());
}
```

Implement `ompToolMapping()` with exactly these behavioral statements: skill use reads `skill://<name>/SKILL.md`; built-ins are lowercase `read`, `write`, `edit`, `bash`, `grep`, and `glob`; subagent workflows use lowercase `task`; legacy `TodoWrite` tracking uses lowercase `todo`; capitalized `Skill`, `Task`, and `TodoWrite` must never be invented.

Do not declare `omp.skills`: OMP discovers the installed package-root `skills/` conventionally.

- [ ] **Step 4: Run the OMP extension test to verify GREEN**

Run:

```bash
node --experimental-strip-types --test tests/omp/test-omp-extension.mjs
```

Expected: all seven OMP tests pass with no Pi adapter import or dormant discovery hook.

- [ ] **Step 5: Commit the native OMP extension**

```bash
git add package.json .omp/extensions/superpowers.ts tests/omp/test-omp-extension.mjs
git commit -m "feat: add native OMP extension"
```

## Task 4: OMP installation documentation

**Files:**
- Create: `.omp/INSTALL.md`
- Modify: `README.md`
- Create: `tests/omp/test-omp-docs.mjs`

**Interfaces:**
- Consumes: the OMP plugin manifest and adapter delivered in Task 3.
- Produces: installation instructions that let a user install, verify, diagnose, and remove the native integration.

- [ ] **Step 1: Write failing documentation contract tests**

Create `tests/omp/test-omp-docs.mjs` using `node:assert/strict`, `readFile`, and a `readRepoFile(relativePath)` helper. Add these tests:

1. README contains `[Oh My Pi (OMP)](#oh-my-pi-omp)`, a `### Oh My Pi (OMP)` section after `### Pi`, `omp plugin install github:obra/superpowers`, `omp plugin link /absolute/path/to/superpowers`, a link to `.omp/INSTALL.md`, and text identifying native manifest plus lowercase `task`/`todo` behavior.
2. `.omp/INSTALL.md` contains all of: `omp plugin install github:obra/superpowers`, `omp plugin link /absolute/path/to/superpowers`, `omp plugin list --json`, `omp plugin list`, `omp plugin uninstall superpowers`, `~/.omp/logs/`, and `> Let's make a react todo list`.
3. The guide says it was verified with OMP `18.1.18` but does not say OMP `>= 18.1.18`, `18.1.18+`, `or newer`, `or later`, `and above`, `minimum`, or `at least`.
4. The guide states that `brainstorming` auto-triggers before code but contains no claim that marketplace installation does not load `omp.extensions`.

- [ ] **Step 2: Run the documentation test to verify RED**

Run:

```bash
node --test tests/omp/test-omp-docs.mjs
```

Expected: FAIL because the OMP section and install guide do not yet exist.

- [ ] **Step 3: Write concise installation documentation**

Add `### Oh My Pi (OMP)` immediately after the Pi section in `README.md`. Include the Git installation command, the local-link command, one sentence that OMP loads the native manifest and uses lowercase `task` and `todo`, and a link to `.omp/INSTALL.md`.

Create `.omp/INSTALL.md` with sections `Prerequisite`, `Install from git`, `Local development`, `Verify`, and `Remove`.

Use these commands verbatim:

```bash
omp plugin install github:obra/superpowers
omp plugin link /absolute/path/to/superpowers
omp plugin list --json
omp plugin uninstall superpowers
```

State that the integration was verified with OMP 18.1.18 and that this is neither a minimum nor compatibility floor. Tell users to restart OMP or start a new session after installation. Direct them to start a clean session with `Let's make a react todo list`; explain that the bootstrap should load and `brainstorming` should trigger before code. For failures, direct users to `~/.omp/logs/`. Do not make any claim about marketplace extension loading.

- [ ] **Step 4: Run the documentation test to verify GREEN**

Run:

```bash
node --test tests/omp/test-omp-docs.mjs
```

Expected: all four documentation contracts pass.

- [ ] **Step 5: Commit the OMP documentation**

```bash
git add README.md .omp/INSTALL.md tests/omp/test-omp-docs.mjs
git commit -m "docs: document OMP installation"
```

## Task 5: Package and real OMP acceptance verification

**Files:**
- Verify only: all files from Tasks 1–4

**Interfaces:**
- Consumes: the built package, native OMP plugin loader, and configured model credentials.
- Produces: evidence that an installed, linked native OMP plugin auto-triggers brainstorming before implementation.

- [ ] **Step 1: Run the focused automated regression set**

Run:

```bash
node --experimental-strip-types --test \
  tests/integrations/test-bootstrap-core.mjs \
  tests/pi/test-pi-extension.mjs \
  tests/omp/test-omp-extension.mjs
node --test tests/omp/test-omp-docs.mjs
git diff --check
npm pack --dry-run --json
```

Expected: every Node test passes, `git diff --check` emits nothing, and `npm pack --dry-run --json` lists `.omp/extensions/superpowers.ts`, `integrations/shared/bootstrap.ts`, and `skills/using-superpowers/SKILL.md` in the package files.

- [ ] **Step 2: Run the clean-session OMP smoke test in a disposable project scope**

Run the following from the repository root. It keeps plugin registry state inside a temporary project rather than altering the user's installed plugins:

```bash
smoke_root=$(mktemp -d)
repo_root=$(pwd -P)
(
  cd "$smoke_root"
  omp plugin link --scope project "$repo_root"
  omp --cwd "$smoke_root" --session-dir "$smoke_root/sessions" --mode json -p \
    "Let's make a react todo list" | tee "$smoke_root/acceptance.jsonl"
)
```

Inspect `acceptance.jsonl`. The first model tool call must read `skill://brainstorming/SKILL.md`; no `write` or `edit` tool call may precede it; the turn must use lowercase `todo` if task tracking is created; and the final model response must remain in brainstorming rather than create code. Record the exact OMP version and a concise tool-call/result summary in the implementation report before removing the disposable output.

- [ ] **Step 3: Remove the disposable smoke-test project**

After capturing evidence, remove only the temporary directory created in Step 2:

```bash
rm -rf "$smoke_root"
```

This removes the project-scoped linked-plugin registry and session artifacts without touching user-scoped OMP plugins.

- [ ] **Step 4: Commit only if verification required a tracked correction**

If Steps 1–3 expose a code or documentation defect, fix it with a new RED-GREEN task and commit that correction. If they pass without tracked changes, do not create an empty verification commit.
