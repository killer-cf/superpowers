# OMP Tool Mapping

Skills speak in actions ("dispatch a subagent", "create a todo", "read a file"). On Oh My Pi (OMP) these resolve to the tools below. OMP tool names are lowercase; never invent capitalized `Skill`, `Task`, or `TodoWrite` calls.

| Action skills request | OMP equivalent |
| --- | --- |
| Invoke a skill (`Skill` tool) | `read` the skill at `skill://<name>/SKILL.md` |
| Read a file | `read` |
| Create / overwrite a file | `write` |
| Edit a file | `edit` |
| Run a shell command | `bash` |
| Search file contents | `grep` |
| Find files by name | `glob` |
| Dispatch a subagent (`Subagent (general-purpose):` template) | `task` |
| Task tracking ("create a todo", "mark complete") | `todo` |

## Skills

OMP discovers the bundled `skills/` directory natively from the installed plugin. When a skill applies, read its `SKILL.md` through the `skill://` URL with `read`. On OMP that is the platform's skill-loading mechanism, so it honors the "never read skill files manually" rule rather than breaking it.

## Subagents

Use the `task` tool for subagent workflows. Put the agent type inside each task item, not at the top level. Subagents start without the conversation, so pass the full task requirements in the call.

## Task lists

Use the `todo` tool for task tracking. Older Superpowers docs may refer to `TodoWrite`; treat that as the `todo` action.
