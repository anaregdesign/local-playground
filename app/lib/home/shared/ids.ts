/**
 * Home runtime support module.
 */
export function createId(prefix: string): string {
  const randomPart = Math.random().toString(36).slice(2);
  return `${prefix}-${Date.now()}-${randomPart}`;
}
