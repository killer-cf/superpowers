# Native Oh My Pi Extension Design

## Goal

Add first-class Oh My Pi (OMP) support to this branch without changing Superpowers skill content or adding runtime dependencies. An installed OMP plugin must discover bundled skills and inject the `using-superpowers` bootstrap at the beginning of a session and after context compaction.

The supported behavior will be verified on the locally installed OMP `18.1.18`. That records the verified environment; it is not a compatibility floor.

## Context

The repository already supports Pi through `.pi/extensions/superpowers.ts`. Its adapter discovers `skills/`, injects a wrapped user message containing `using-superpowers`, avoids duplicate injection using a marker, reinjects after compaction, and disables itself at `agent_end`.

OMP can load package extension entries from `package.json#omp.extensions`. Its native plugin discovery exposes the package-root `skills/` directory, so OMP must not register Pi's `resources_discover` hook. The live OMP lifecycle hooks needed for the same bootstrap semantics are `session_start`, `session_compact`, `context`, and `agent_end`.

Upstream PR #1996 is design reference only. It remains open and has neither formal review nor published CI checks, so this branch will implement and verify its own result. The design deliberately does not copy its version-specific assertion that marketplace installs cannot load extension modules.

## Scope

### In scope

- A native OMP extension declared through the root package manifest.
- A minimal shared bootstrap controller used by both Pi and OMP adapters.
- OMP-specific tool guidance for skill loading, built-in file/search tools, subagents, and task tracking.
- Automated contract coverage for the shared controller, OMP adapter, and preserved Pi behavior.
- User-facing installation, local-development, diagnostics, removal, and clean-session verification instructions.
- A real OMP smoke test from a locally linked checkout.

### Out of scope

- New Superpowers skills or changes to behavior-shaping skill content.
- OMP marketplace catalog packaging or changes to the existing Claude plugin compatibility path.
- Drill/eval backend support.
- A new upstream pull request; an open upstream proposal already covers this feature.
- A promise of compatibility across all OMP releases.

## Architecture

### Shared bootstrap controller

Create `integrations/shared/bootstrap.ts`. It owns only harness-neutral bootstrap policy:

- Load the configured `skills/using-superpowers/SKILL.md` once per adapter instance.
- Remove YAML frontmatter before embedding the skill body.
- Construct one `<EXTREMELY_IMPORTANT>` user-role message that includes a harness-specific marker, a harness-specific "already loaded" instruction, and tool guidance.
- Arm injection at session start and after compaction; disarm it at agent end.
- Skip injection if an existing string or multipart text message already contains the marker.
- Insert the bootstrap after every leading `compactionSummary`, preserving the identity and order of all existing messages.
- Fail soft when the bootstrap cannot be read: emit one structured warning through an optional callback, cache the failure, and never interfere with the host session.

The controller has no Pi or OMP SDK import. It returns the minimal `{ messages }` shape expected by both adapters and does not mutate the host-provided message array.

### Pi adapter

Refactor `.pi/extensions/superpowers.ts` to instantiate the controller while retaining Pi-specific behavior:

- Keep `resources_discover` and return the absolute bundled `skills/` directory.
- Keep the existing Pi lifecycle hooks.
- Retain Pi-specific mapping text and marker.
- Report an unavailable bootstrap through Pi's logger when present, otherwise a single `console.warn` diagnostic.

The refactor must not import OMP code or alter the Pi manifest.

### OMP adapter

Create `.omp/extensions/superpowers.ts` and import `ContextEvent` and `ExtensionAPI` as types from `@oh-my-pi/pi-coding-agent`. It derives the package root from `import.meta.url`, then instantiates the shared controller with:

- an OMP-specific marker and loaded-message text;
- the root `skills/using-superpowers/SKILL.md` path;
- `omp.logger.warn` as the diagnostic sink;
- OMP-native tool guidance.

It registers exactly `session_start`, `session_compact`, `context`, and `agent_end`. It does not register `resources_discover`, `session_before_compact`, or Pi adapter code.

OMP guidance will direct the model to read `skill://<name>/SKILL.md` when a skill applies; use lowercase `read`, `write`, `edit`, `bash`, `grep`, and `glob`; use lowercase `task` for subagents; and use lowercase `todo` for legacy `TodoWrite` task tracking. It explicitly forbids invented capitalized `Skill`, `Task`, and `TodoWrite` calls.

### Package and documentation

Add this root-manifest entry while retaining `pi` unchanged:

```json
"omp": {
  "extensions": ["./.omp/extensions/superpowers.ts"]
}
```

Add `.omp/INSTALL.md`, then link it from a new OMP section beside the Pi installation section in `README.md`. Documentation will cover:

- `omp plugin install github:obra/superpowers` for user installation;
- `omp plugin link /absolute/path/to/superpowers` for local development;
- restarting or opening a clean OMP session after install/link;
- `omp plugin list --json` for registration inspection;
- the exact acceptance prompt `Let's make a react todo list`;
- expected brainstorming behavior before code; OMP diagnostics; and uninstall.

It will state the verified OMP version without presenting it as a minimum. Marketplace behavior will not be asserted because it differs across OMP releases.

## Data flow

1. OMP loads the plugin from `package.json#omp.extensions` and discovers the package-root `skills/` directory.
2. The OMP factory registers lifecycle handlers; it does not perform runtime actions while loading.
3. `session_start` arms the controller. The next `context` event inserts the bootstrap after leading compaction summaries.
4. The bootstrap teaches the model that Superpowers is loaded and maps Superpowers actions to OMP-native interfaces.
5. A marker in an already-present bootstrap suppresses duplicate injection.
6. `session_compact` re-arms the controller, so the next context receives the bootstrap after summaries.
7. `agent_end` disarms it. Missing bootstrap content produces one warning and leaves the session otherwise unchanged.

Pi follows the same controller lifecycle, with its existing resource-discovery hook and Pi-specific guidance.

## Error handling and invariants

- Extension load and runtime must not depend on an added package dependency.
- Reading the bootstrap may fail; the failure is cached and reported once, never thrown through context injection.
- A throwing diagnostic callback cannot break injection.
- The controller must preserve input message ordering, object identity, and immutability.
- Any existing marker in string content or a multipart text component prevents a second bootstrap.
- OMP must rely on its package-root skill discovery rather than dormant `resources_discover` registration.
- Pi must preserve its live `resources_discover` behavior.

## Verification

### Automated contracts

Add `tests/integrations/test-bootstrap-core.mjs` for controller state, frontmatter stripping, caching, deduplication, compaction placement, immutable message handling, and diagnostics.

Add `tests/omp/test-omp-extension.mjs` with a fake OMP host to verify the OMP manifest, native imports, controller-only dependency direction, exact lifecycle registrations, no dormant discovery hook, mapping content, startup/compaction injection, disarming, deduplication, and a one-time logger warning.

Extend `tests/pi/test-pi-extension.mjs` to prove the refactor preserves the Pi manifest, `resources_discover`, lifecycle behavior, Pi mapping, and controller separation. Add OMP documentation checks only for user-observable install and verification instructions; do not test wording without a concrete contract.

### Runtime smoke test

After automated tests pass, link this checkout using `omp plugin link`, start a clean OMP session, and send exactly:

> Let's make a react todo list

Success requires the bootstrap to cause `brainstorming` to load before any write/edit action and the response to remain in the design conversation. Remove the linked test plugin after the smoke test unless it was already installed by the user.

### Final checks

Run the focused Node test set, `git diff --check`, and `npm pack --dry-run --json`. The package dry run must include the OMP adapter, shared controller, and bundled skills.

## File inventory

- Create: `integrations/shared/bootstrap.ts`
- Create: `.omp/extensions/superpowers.ts`
- Create: `.omp/INSTALL.md`
- Create: `tests/integrations/test-bootstrap-core.mjs`
- Create: `tests/omp/test-omp-extension.mjs`
- Create: `tests/omp/test-omp-docs.mjs`
- Modify: `.pi/extensions/superpowers.ts`
- Modify: `package.json`
- Modify: `tests/pi/test-pi-extension.mjs`
- Modify: `README.md`

No other production paths need change.
