export function isLikelyChatAzureAuthError(message: string | null): boolean {
  if (!message) {
    return false;
  }

  const normalizedMessage = message.toLowerCase();
  return [
    "azure login is required",
    "defaultazurecredential",
    "interactivebrowsercredential",
    "authenticationrequirederror",
    "automatic authentication has been disabled",
    "credential",
    "authentication",
    "authorization",
    "unauthorized",
    "forbidden",
    "access token",
    "aadsts",
  ].some((pattern) => normalizedMessage.includes(pattern));
}
