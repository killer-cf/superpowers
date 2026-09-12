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

function ompToolMapping(): string {
  return `## OMP tool mapping

When a Superpowers instruction says to use a skill, read \`skill://<name>/SKILL.md\` with the native \`read\` tool.

OMP's built-in coding tools are lowercase: \`read\`, \`write\`, \`edit\`, \`bash\`, \`grep\`, and \`glob\`.

Use the lowercase \`task\` tool for subagent workflows. Use lowercase \`todo\` for legacy \`TodoWrite\` task tracking. Never invent capitalized \`Skill\`, \`Task\`, or \`TodoWrite\` calls.`;
}
