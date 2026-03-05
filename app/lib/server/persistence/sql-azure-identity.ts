/**
 * SQL Azure Identity authentication helpers.
 */
import { DefaultAzureCredential } from "@azure/identity";
import {
  buildSqlDatabaseUrlWithPassword,
  type PersistenceDatabaseProvider,
} from "~/lib/server/persistence/database-config";

export type SqlAzureIdentityTokenState = {
  token: string;
  expiresOnTimestamp: number;
};

type ResolveSqlAzureIdentityDatabaseUrlOptions = {
  provider: Exclude<PersistenceDatabaseProvider, "sqlite">;
  databaseUrl: string;
  azureIdentityClientId: string;
  scope: string;
};

export async function resolveSqlAzureIdentityDatabaseUrl(
  options: ResolveSqlAzureIdentityDatabaseUrlOptions,
): Promise<{
  databaseUrl: string;
  tokenState: SqlAzureIdentityTokenState;
}> {
  const credential = new DefaultAzureCredential({
    managedIdentityClientId: options.azureIdentityClientId || undefined,
  });
  const accessToken = await credential.getToken(options.scope);
  if (!accessToken?.token) {
    throw new Error(
      `DefaultAzureCredential did not return an access token for ${options.provider} Azure Identity authentication.`,
    );
  }

  return {
    databaseUrl: buildSqlDatabaseUrlWithPassword({
      provider: options.provider,
      databaseUrl: options.databaseUrl,
      password: accessToken.token,
    }),
    tokenState: {
      token: accessToken.token,
      expiresOnTimestamp: accessToken.expiresOnTimestamp,
    },
  };
}
