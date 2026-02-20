type McpServersAuthLike = {
  authRequired?: boolean;
};

export function isMcpServersAuthRequired(
  status: number,
  payload: McpServersAuthLike | null | undefined,
): boolean {
  return status === 401 || payload?.authRequired === true;
}

export function shouldScheduleSavedMcpLoginRetry(
  wasAzureAuthRequired: boolean,
  savedMcpUserKey: string,
): boolean {
  return wasAzureAuthRequired && savedMcpUserKey.trim().length > 0;
}
