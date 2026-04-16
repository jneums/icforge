import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { parse as parseYaml } from "yaml";

// ============================================================
// ICForge config — thin wrapper, icp.yaml is icp-cli's concern
// ============================================================

const ICFORGE_FILE = ".icforge";
const ICP_MANIFEST = "icp.yaml";

/** ICForge-specific config (stored in .icforge) */
export interface ICForgeConfig {
  projectId: string;
  /** Project slug for vanity URL (<slug>.icforge.dev) */
  slug?: string;
}

/** Minimal canister info extracted from icp.yaml — names + recipes only */
export interface CanisterInfo {
  name: string;
  recipe?: string;
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
 * Extract canister names and recipes from icp.yaml.
 * Minimal parsing — we only need names for DB records and recipes for display.
 * Supports both inline canister objects and string references to canister.yaml files.
 * Returns null if no icp.yaml found.
 */
export async function extractCanisters(dir: string = process.cwd()): Promise<CanisterInfo[] | null> {
  const manifestPath = join(dir, ICP_MANIFEST);
  if (!existsSync(manifestPath)) return null;
  const raw = await readFile(manifestPath, "utf-8");
  const parsed = parseYaml(raw) as Record<string, unknown>;

  if (!parsed?.canisters || !Array.isArray(parsed.canisters)) {
    return [];
  }

  const result: CanisterInfo[] = [];
  for (const entry of parsed.canisters) {
    if (typeof entry === "string") {
      // String entry — try to read <dir>/<entry>/canister.yaml for recipe
      const canisterYamlPath = join(dir, entry, "canister.yaml");
      if (existsSync(canisterYamlPath)) {
        const canisterRaw = await readFile(canisterYamlPath, "utf-8");
        const canisterParsed = parseYaml(canisterRaw) as Record<string, unknown>;
        const recipe = extractRecipe(canisterParsed);
        result.push({ name: entry, recipe });
      } else {
        result.push({ name: entry });
      }
    } else if (typeof entry === "object" && entry !== null) {
      const obj = entry as Record<string, unknown>;
      const name = (obj.name as string) ?? "unknown";
      const recipe = extractRecipe(obj);
      result.push({ name, recipe });
    }
  }

  return result;
}

/**
 * Extract recipe display string from a canister config object.
 * e.g. "@dfinity/rust@v3.1.0" → "rust@v3.1.0"
 */
function extractRecipe(obj: Record<string, unknown>): string | undefined {
  const recipe = obj.recipe;
  if (typeof recipe === "string") {
    return recipe;
  }
  if (typeof recipe === "object" && recipe !== null) {
    const type = (recipe as Record<string, unknown>).type;
    if (typeof type === "string") {
      return type;
    }
  }
  return undefined;
}

/**
 * Check if the current directory is an IC project.
 */
export function isIcProject(dir: string = process.cwd()): boolean {
  return existsSync(join(dir, ICP_MANIFEST));
}

/**
 * Read existing canister IDs from .icp/data/mappings/ic.ids.json (if present).
 * These are canisters the user has already deployed outside of ICForge (BYOC).
 * Returns a map of canister_name → canister_id.
 */
export async function readExistingCanisterIds(dir: string = process.cwd()): Promise<Record<string, string>> {
  const idsPath = join(dir, ".icp", "data", "mappings", "ic.ids.json");
  if (!existsSync(idsPath)) return {};
  try {
    const raw = await readFile(idsPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const result: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "string" && value.length > 0) {
          result[key] = value;
        }
      }
      return result;
    }
  } catch {
    // Malformed JSON — ignore
  }
  return {};
}

/**
 * Check if the current directory is linked to ICForge.
 */
export function isLinked(dir: string = process.cwd()): boolean {
  return existsSync(join(dir, ICFORGE_FILE));
}
