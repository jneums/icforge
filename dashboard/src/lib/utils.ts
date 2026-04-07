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
