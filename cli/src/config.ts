import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

const CONFIG_FILE = "atlascloud.json";

export interface ProjectConfig {
  name: string;
  projectId?: string;
  framework?: "static" | "react" | "nextjs" | "svelte" | "motoko" | "rust";
  buildCommand?: string;
  outputDir?: string;
  canisters?: CanisterConfig[];
}

export interface CanisterConfig {
  name: string;
  type: "frontend" | "backend";
  source?: string;
}

export async function loadConfig(dir: string = process.cwd()): Promise<ProjectConfig | null> {
  const configPath = join(dir, CONFIG_FILE);
  if (!existsSync(configPath)) return null;
  const raw = await readFile(configPath, "utf-8");
  return JSON.parse(raw) as ProjectConfig;
}

export async function saveConfig(config: ProjectConfig, dir: string = process.cwd()) {
  const configPath = join(dir, CONFIG_FILE);
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
}
