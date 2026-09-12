import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
): BootstrapController<Message> {
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

  function containsMarker(message: unknown): boolean {
    if (!isRecord(message)) return false;
    const content = message.content;
    if (typeof content === "string") return content.includes(config.bootstrapMarker);
    if (!Array.isArray(content)) return false;
    return content.some(
      (part) =>
        isRecord(part) &&
        part.type === "text" &&
        typeof part.text === "string" &&
        part.text.includes(config.bootstrapMarker),
    );
  }

  function inject(messages: Message[]): { messages: Message[] } | undefined {
    if (!armed || messages.some(containsMarker)) return undefined;

    const bootstrap = getBootstrap();
    if (bootstrap === null) return undefined;

    let insertionIndex = 0;
    while (
      insertionIndex < messages.length &&
      isRecord(messages[insertionIndex]) &&
      messages[insertionIndex].role === "compactionSummary"
    ) {
      insertionIndex += 1;
    }

    const bootstrapMessage = {
      role: "user",
      content: [{ type: "text", text: bootstrap }],
      timestamp: Date.now(),
    } as Message;
    return {
      messages: [
        ...messages.slice(0, insertionIndex),
        bootstrapMessage,
        ...messages.slice(insertionIndex),
      ],
    };
  }

  return {
    arm() {
      armed = true;
    },
    disarm() {
      armed = false;
    },
    inject,
  };
}

function stripFrontmatter(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return (match ? match[1] : content).trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
