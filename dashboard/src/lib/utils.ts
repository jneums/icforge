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

/**
 * Derive a health level string from a cycles balance (in cycles).
 * Matches the backend's cycles_health_level() thresholds.
 */
export type HealthLevel = "healthy" | "warning" | "critical" | "frozen" | "unknown";

export function cyclesHealthLevel(balance: number | null | undefined): HealthLevel {
  if (balance == null) return "unknown";
  if (balance <= 0) return "frozen";
  if (balance < 500_000_000_000) return "critical";
  if (balance < 2_000_000_000_000) return "warning";
  return "healthy";
}

/**
 * Format cycles for human display (e.g. 3.5T, 450B, 12M).
 */
export function formatCycles(cycles: number): string {
  if (cycles >= 1_000_000_000_000) return `${(cycles / 1_000_000_000_000).toFixed(1)}T`;
  if (cycles >= 1_000_000_000) return `${(cycles / 1_000_000_000).toFixed(0)}B`;
  if (cycles >= 1_000_000) return `${(cycles / 1_000_000).toFixed(0)}M`;
  if (cycles >= 1_000) return `${(cycles / 1_000).toFixed(0)}K`;
  return `${cycles}`;
}
