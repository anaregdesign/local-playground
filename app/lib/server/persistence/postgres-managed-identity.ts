/**
 * PostgreSQL Managed Identity authentication helpers.
 */
import { DefaultAzureCredential } from "@azure/identity";
import { buildPostgresDatabaseUrlWithPassword } from "~/lib/server/persistence/database-config";

export type ManagedIdentityTokenState = {
  token: string;
  expiresOnTimestamp: number;
};

type ResolvePostgresManagedIdentityDatabaseUrlOptions = {
  databaseUrl: string;
  managedIdentityClientId: string;
  scope: string;
};

export async function resolvePostgresManagedIdentityDatabaseUrl(
  options: ResolvePostgresManagedIdentityDatabaseUrlOptions,
): Promise<{
  databaseUrl: string;
  tokenState: ManagedIdentityTokenState;
}> {
  const credential = new DefaultAzureCredential({
    managedIdentityClientId: options.managedIdentityClientId || undefined,
  });
  const accessToken = await credential.getToken(options.scope);
  if (!accessToken?.token) {
    throw new Error(
      "DefaultAzureCredential did not return a PostgreSQL access token for Managed Identity authentication.",
    );
  }

  return {
    databaseUrl: buildPostgresDatabaseUrlWithPassword(options.databaseUrl, accessToken.token),
    tokenState: {
      token: accessToken.token,
      expiresOnTimestamp: accessToken.expiresOnTimestamp,
    },
  };
}
