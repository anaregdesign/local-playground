/**
 * PostgreSQL Azure Identity authentication helpers.
 */
import { DefaultAzureCredential } from "@azure/identity";
import { buildPostgresDatabaseUrlWithPassword } from "~/lib/server/persistence/database-config";

export type PostgresAzureIdentityTokenState = {
  token: string;
  expiresOnTimestamp: number;
};

type ResolvePostgresAzureIdentityDatabaseUrlOptions = {
  databaseUrl: string;
  azureIdentityClientId: string;
  scope: string;
};

export async function resolvePostgresAzureIdentityDatabaseUrl(
  options: ResolvePostgresAzureIdentityDatabaseUrlOptions,
): Promise<{
  databaseUrl: string;
  tokenState: PostgresAzureIdentityTokenState;
}> {
  const credential = new DefaultAzureCredential({
    managedIdentityClientId: options.azureIdentityClientId || undefined,
  });
  const accessToken = await credential.getToken(options.scope);
  if (!accessToken?.token) {
    throw new Error(
      "DefaultAzureCredential did not return a PostgreSQL access token for Azure Identity authentication.",
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
