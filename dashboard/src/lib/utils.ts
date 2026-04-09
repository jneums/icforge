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
 * Derive a health level from a cycles balance.
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

/**
 * Convert raw cycles to a USD string for display purposes.
 * 1 trillion cycles = 1 XDR ≈ $1.37 USD (fetched live on backend).
 * This uses a default XDR/USD rate for quick display — the backend
 * provides exact compute_value_cents for billing-critical views.
 */
const DEFAULT_XDR_USD = 1.37; // fallback; backend refreshes every 6h

export function cyclesToUsd(cycles: number, xdrUsd: number = DEFAULT_XDR_USD): string {
  const usd = (cycles / 1_000_000_000_000) * xdrUsd;
  return `$${usd.toFixed(2)}`;
}
