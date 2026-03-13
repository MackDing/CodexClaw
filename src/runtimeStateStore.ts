import fs from "node:fs/promises";
import type { AppConfig } from "./config.js";
import type { McpClientSnapshot } from "./orchestrator/mcpClient.js";
import type { PtyManagerSnapshot } from "./runner/ptyManager.js";
import type { SkillRegistrySnapshot } from "./orchestrator/skillRegistry.js";

export interface RuntimeStateSnapshot {
  version: number;
  updatedAt?: string;
  mcp: McpClientSnapshot;
  runner: PtyManagerSnapshot;
  skills: SkillRegistrySnapshot;
}

type PersistedSnapshot = Partial<RuntimeStateSnapshot>;

function defaultState(): RuntimeStateSnapshot {
  return {
    version: 1,
    mcp: {
      disabledServers: []
    },
    runner: {
      chats: {}
    },
    skills: {
      chats: {}
    }
  };
}

export class RuntimeStateStore {
  readonly file: string;
  private writeQueue: Promise<void>;

  constructor({ config }: { config: Pick<AppConfig, "app"> }) {
    this.file = config.app.stateFile;
    this.writeQueue = Promise.resolve();
  }

  async load(): Promise<RuntimeStateSnapshot> {
    try {
      const raw = await fs.readFile(this.file, "utf8");
      const parsed = JSON.parse(raw) as PersistedSnapshot;
      return {
        ...defaultState(),
        ...parsed,
        mcp: {
          ...defaultState().mcp,
          ...(parsed?.mcp || {})
        },
        runner: {
          ...defaultState().runner,
          ...(parsed?.runner || {})
        },
        skills: {
          ...defaultState().skills,
          ...(parsed?.skills || {})
        }
      };
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return defaultState();
      }

      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[state] failed to load runtime state: ${message}`);
      return defaultState();
    }
  }

  async save(
    snapshot: Omit<RuntimeStateSnapshot, "version" | "updatedAt">
  ): Promise<void> {
    const payload = JSON.stringify(
      {
        version: 1,
        updatedAt: new Date().toISOString(),
        ...snapshot
      },
      null,
      2
    );

    this.writeQueue = this.writeQueue
      .then(async () => {
        const tempFile = `${this.file}.tmp`;
        await fs.writeFile(tempFile, payload, "utf8");
        await fs.rename(tempFile, this.file);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[state] failed to save runtime state: ${message}`);
      });

    return this.writeQueue;
  }
}
