export async function readJsonPayload<T extends Record<string, unknown>>(
  response: Response,
  targetName: string,
): Promise<T> {
  const rawPayload = await response.text();
  const trimmedPayload = rawPayload.trim();
  if (!trimmedPayload) {
    return {} as T;
  }

  try {
    return JSON.parse(trimmedPayload) as T;
  } catch {
    if (response.status === 401) {
      return { authRequired: true } as unknown as T;
    }

    const preview = trimmedPayload.length > 160 ? `${trimmedPayload.slice(0, 160)}...` : trimmedPayload;
    throw new Error(
      `Failed to parse ${targetName} response (status ${response.status}): ${preview}`,
    );
  }
}
