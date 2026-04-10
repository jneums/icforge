import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format an icp-cli recipe string for display.
 * Strips the @dfinity/ scope prefix if present.
 * e.g. "@dfinity/rust@v3.1.0" → "rust@v3.1.0"
 *      "custom" → "custom"
 */
export function displayRecipe(recipe: string): string {
  return recipe.replace(/^@dfinity\//, "");
}

export type HealthLevel = "healthy" | "warning" | "critical" | "frozen" | "unknown";

/**
 * Derive a health level from a raw compute balance.
 * Matches the backend's cycles_health_level() thresholds.
 * Used for quick inline badges when the full health endpoint isn't loaded.
 */
export function healthFromCycles(balance: number | null | undefined): HealthLevel {
  if (balance == null) return "unknown";
  if (balance <= 0) return "frozen";
  if (balance < 500_000_000_000) return "critical";
  if (balance < 2_000_000_000_000) return "warning";
  return "healthy";
}


