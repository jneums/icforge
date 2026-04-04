import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { parse as parseYaml } from "yaml";

// ============================================================
// ICForge config — thin wrapper, icp.yaml is source of truth
// ============================================================

const ICFORGE_FILE = ".icforge";
const ICP_MANIFEST = "icp.yaml";

/** ICForge-specific config (stored in .icforge) */
export interface ICForgeConfig {
  projectId: string;
  /** Project slug for vanity URL (<slug>.icforge.dev) */
  slug?: string;
  /** Optional: only deploy these canisters (default: all from icp.yaml) */
  canisters?: string[];
  /** Optional: custom subdomain override */
  subdomain?: string;
  /** Optional: target subnet ID for canister creation */
  subnet?: string;
}

/** Canister definition parsed from icp.yaml */
export interface IcpCanister {
  name: string;
  type?: string;
  recipe?: {
    type: string;
    configuration?: Record<string, unknown>;
  };
  build?: string[];
  source?: string;
  /** Explicit path to wasm output file */
  wasm?: string;
  /** Hex-encoded Candid init arg for canister installation */
  init_arg?: string;
  /** Path to .did file (Candid interface definition) */
  candid?: string;
  /** Canister dependencies (names of other canisters this one depends on) */
  dependencies?: string[];
}

/** Parsed icp.yaml manifest */
export interface IcpManifest {
  canisters: IcpCanister[];
  environments?: Array<{
    name: string;
    [key: string]: unknown;
  }>;
  defaults?: Record<string, unknown>;
}

/**
 * Load the .icforge project link file.
 * Returns null if not initialized.
 */
export async function loadICForgeConfig(dir: string = process.cwd()): Promise<ICForgeConfig | null> {
  const configPath = join(dir, ICFORGE_FILE);
  if (!existsSync(configPath)) return null;
  const raw = await readFile(configPath, "utf-8");
  return JSON.parse(raw) as ICForgeConfig;
}

/**
 * Save the .icforge project link file.
 */
export async function saveICForgeConfig(config: ICForgeConfig, dir: string = process.cwd()) {
  const configPath = join(dir, ICFORGE_FILE);
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
}

/**
 * Load and parse the icp.yaml manifest.
 * This is the source of truth for canister definitions.
 * Returns null if no icp.yaml found.
 */
export async function loadIcpManifest(dir: string = process.cwd()): Promise<IcpManifest | null> {
  const manifestPath = join(dir, ICP_MANIFEST);
  if (!existsSync(manifestPath)) return null;
  const raw = await readFile(manifestPath, "utf-8");
  return parseYaml(raw) as IcpManifest;
}

/**
 * Detect canister type from icp.yaml recipe.
 * Maps IC recipe types to ICForge's frontend/backend classification.
 */
export function classifyCanister(canister: IcpCanister): "frontend" | "backend" {
  const recipe = canister.recipe?.type?.toLowerCase() ?? "";
  if (recipe.includes("asset-canister") || recipe.includes("asset")) {
    return "frontend";
  }
  return "backend";
}

/**
 * Check if the current directory is an IC project.
 */
export function isIcProject(dir: string = process.cwd()): boolean {
  return existsSync(join(dir, ICP_MANIFEST));
}

/**
 * Check if the current directory is linked to ICForge.
 */
export function isLinked(dir: string = process.cwd()): boolean {
  return existsSync(join(dir, ICFORGE_FILE));
}
