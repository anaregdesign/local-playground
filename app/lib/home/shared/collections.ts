/**
 * Deduplicates case-insensitively while preserving the first-seen casing/order.
 */
export function uniqueStringsCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(value);
  }

  return unique;
}

/**
 * Normalizes unknown arrays into trimmed, non-empty string lists.
 */
export function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }

    const normalized = entry.trim();
    if (!normalized) {
      continue;
    }

    result.push(normalized);
  }

  return result;
}
