/**
 * Tests for persistence database configuration helpers.
 */
import { describe, expect, it } from "vitest";
import {
  buildSqlDatabaseUrlWithPassword,
  resolvePersistenceDatabaseConfig,
} from "~/lib/server/persistence/database-config";

describe("resolvePersistenceDatabaseConfig", () => {
  it("defaults to sqlite with the foundry database path", () => {
    const config = resolvePersistenceDatabaseConfig({
      env: {},
      platform: "linux",
      homeDirectory: "/home/hiroki",
    });

    expect(config).toEqual({
      provider: "sqlite",
      databaseUrl: "file:/home/hiroki/.foundry_local_playground/local-playground.sqlite",
      sqlAuthentication: null,
    });
  });

  it("uses postgres provider when database URL is postgres", () => {
    const config = resolvePersistenceDatabaseConfig({
      env: {
        DATABASE_URL: "postgresql://db-user:db-pass@db.example.com:5432/local_playground",
      },
    });

    expect(config.provider).toBe("postgresql");
    expect(config.databaseUrl).toBe(
      "postgresql://db-user:db-pass@db.example.com:5432/local_playground?sslmode=require",
    );
    expect(config.sqlAuthentication).toEqual({
      method: "password",
    });
  });

  it("builds postgres URL from component environment values", () => {
    const config = resolvePersistenceDatabaseConfig({
      env: {
        LOCAL_PLAYGROUND_POSTGRES_HOST: "db.example.com",
        LOCAL_PLAYGROUND_POSTGRES_DATABASE: "local_playground",
        LOCAL_PLAYGROUND_POSTGRES_USER: "db-user",
        LOCAL_PLAYGROUND_POSTGRES_PASSWORD: "db-pass",
        LOCAL_PLAYGROUND_POSTGRES_SCHEMA: "public",
      },
    });

    expect(config.provider).toBe("postgresql");
    expect(config.databaseUrl).toBe(
      "postgresql://db-user:db-pass@db.example.com:5432/local_playground?sslmode=require&schema=public",
    );
    expect(config.sqlAuthentication).toEqual({
      method: "password",
    });
  });

  it("uses mysql provider when database URL is mysql", () => {
    const config = resolvePersistenceDatabaseConfig({
      env: {
        DATABASE_URL: "mysql://db-user:db-pass@db.example.com:3306/local_playground",
      },
    });

    expect(config.provider).toBe("mysql");
    expect(config.databaseUrl).toBe(
      "mysql://db-user:db-pass@db.example.com:3306/local_playground",
    );
    expect(config.sqlAuthentication).toEqual({
      method: "password",
    });
  });

  it("uses cockroachdb provider when database URL is cockroachdb", () => {
    const config = resolvePersistenceDatabaseConfig({
      env: {
        DATABASE_URL:
          "cockroachdb://db-user:db-pass@db.example.com:26257/local_playground?sslmode=require",
      },
    });

    expect(config.provider).toBe("cockroachdb");
    expect(config.databaseUrl).toBe(
      "cockroachdb://db-user:db-pass@db.example.com:26257/local_playground?sslmode=require",
    );
    expect(config.sqlAuthentication).toEqual({
      method: "password",
    });
  });

  it("uses sqlserver provider when configured", () => {
    const config = resolvePersistenceDatabaseConfig({
      env: {
        DATABASE_PROVIDER: "sqlserver",
        DATABASE_URL:
          "sqlserver://db.example.com:1433;database=local_playground;user=db-user;password=db-pass;encrypt=true",
      },
    });

    expect(config.provider).toBe("sqlserver");
    expect(config.databaseUrl).toBe(
      "sqlserver://db.example.com:1433;database=local_playground;user=db-user;password=db-pass;encrypt=true",
    );
    expect(config.sqlAuthentication).toEqual({
      method: "password",
    });
  });

  it("uses azure identity authentication for mysql when configured", () => {
    const config = resolvePersistenceDatabaseConfig({
      env: {
        LOCAL_PLAYGROUND_DATABASE_PROVIDER: "mysql",
        LOCAL_PLAYGROUND_DATABASE_URL: "mysql://db-user@db.example.com:3306/local_playground",
        LOCAL_PLAYGROUND_DATABASE_AUTH_METHOD: "azure_identity",
        LOCAL_PLAYGROUND_DATABASE_AZURE_IDENTITY_CLIENT_ID:
          "00000000-0000-0000-0000-000000000000",
      },
    });

    expect(config.sqlAuthentication).toEqual({
      method: "azure_identity",
      clientId: "00000000-0000-0000-0000-000000000000",
      scope: "https://ossrdbms-aad.database.windows.net/.default",
    });
  });

  it("uses access token authentication for postgres when configured", () => {
    const config = resolvePersistenceDatabaseConfig({
      env: {
        LOCAL_PLAYGROUND_DATABASE_PROVIDER: "postgresql",
        LOCAL_PLAYGROUND_POSTGRES_HOST: "db.example.com",
        LOCAL_PLAYGROUND_POSTGRES_DATABASE: "local_playground",
        LOCAL_PLAYGROUND_POSTGRES_USER: "db-user",
        LOCAL_PLAYGROUND_DATABASE_AUTH_METHOD: "access_token",
        LOCAL_PLAYGROUND_DATABASE_ACCESS_TOKEN: "postgres-token",
      },
    });

    expect(config.sqlAuthentication).toEqual({
      method: "access_token",
      accessToken: "postgres-token",
    });
  });

  it("throws on provider and URL mismatch", () => {
    expect(() => {
      resolvePersistenceDatabaseConfig({
        env: {
          LOCAL_PLAYGROUND_DATABASE_PROVIDER: "sqlite",
          LOCAL_PLAYGROUND_DATABASE_URL: "postgresql://db.example.com:5432/local_playground",
        },
      });
    }).toThrow("does not match database URL scheme");
  });

  it("throws when postgres components are incomplete", () => {
    expect(() => {
      resolvePersistenceDatabaseConfig({
        env: {
          LOCAL_PLAYGROUND_DATABASE_PROVIDER: "postgresql",
          LOCAL_PLAYGROUND_POSTGRES_HOST: "db.example.com",
        },
      });
    }).toThrow("requires connection settings");
  });

  it("throws when non-postgres provider has no DATABASE_URL", () => {
    expect(() => {
      resolvePersistenceDatabaseConfig({
        env: {
          LOCAL_PLAYGROUND_DATABASE_PROVIDER: "mysql",
        },
      });
    }).toThrow("requires `LOCAL_PLAYGROUND_DATABASE_URL`/`DATABASE_URL` to be set");
  });

  it("throws when auth method is invalid", () => {
    expect(() => {
      resolvePersistenceDatabaseConfig({
        env: {
          LOCAL_PLAYGROUND_DATABASE_PROVIDER: "postgresql",
          LOCAL_PLAYGROUND_POSTGRES_HOST: "db.example.com",
          LOCAL_PLAYGROUND_POSTGRES_DATABASE: "local_playground",
          LOCAL_PLAYGROUND_POSTGRES_USER: "db-user",
          LOCAL_PLAYGROUND_DATABASE_AUTH_METHOD: "invalid",
        },
      });
    }).toThrow("LOCAL_PLAYGROUND_DATABASE_AUTH_METHOD");
  });

  it("throws when access token auth is selected without token", () => {
    expect(() => {
      resolvePersistenceDatabaseConfig({
        env: {
          LOCAL_PLAYGROUND_DATABASE_PROVIDER: "postgresql",
          LOCAL_PLAYGROUND_POSTGRES_HOST: "db.example.com",
          LOCAL_PLAYGROUND_POSTGRES_DATABASE: "local_playground",
          LOCAL_PLAYGROUND_POSTGRES_USER: "db-user",
          LOCAL_PLAYGROUND_DATABASE_AUTH_METHOD: "access_token",
        },
      });
    }).toThrow("LOCAL_PLAYGROUND_DATABASE_ACCESS_TOKEN");
  });

  it("throws when sqlserver requests unsupported auth method", () => {
    expect(() => {
      resolvePersistenceDatabaseConfig({
        env: {
          LOCAL_PLAYGROUND_DATABASE_PROVIDER: "sqlserver",
          LOCAL_PLAYGROUND_DATABASE_URL:
            "sqlserver://db.example.com:1433;database=local_playground;user=db-user;password=db-pass;encrypt=true",
          LOCAL_PLAYGROUND_DATABASE_AUTH_METHOD: "azure_identity",
        },
      });
    }).toThrow("SQL Server currently supports only `password` authentication");
  });
});

describe("buildSqlDatabaseUrlWithPassword", () => {
  it("injects password into postgres URLs", () => {
    const resolved = buildSqlDatabaseUrlWithPassword({
      provider: "postgresql",
      databaseUrl: "postgresql://db-user@db.example.com:5432/local_playground?sslmode=require",
      password: "token-value",
    });

    expect(resolved).toBe(
      "postgresql://db-user:token-value@db.example.com:5432/local_playground?sslmode=require",
    );
  });

  it("injects password into mysql URLs", () => {
    const resolved = buildSqlDatabaseUrlWithPassword({
      provider: "mysql",
      databaseUrl: "mysql://db-user@db.example.com:3306/local_playground",
      password: "token-value",
    });

    expect(resolved).toBe("mysql://db-user:token-value@db.example.com:3306/local_playground");
  });

  it("replaces password in sqlserver URLs", () => {
    const resolved = buildSqlDatabaseUrlWithPassword({
      provider: "sqlserver",
      databaseUrl:
        "sqlserver://db.example.com:1433;database=local_playground;user=db-user;password=old-password;encrypt=true",
      password: "new-password",
    });

    expect(resolved).toBe(
      "sqlserver://db.example.com:1433;database=local_playground;user=db-user;password=new-password;encrypt=true",
    );
  });

  it("appends password in sqlserver URLs when missing", () => {
    const resolved = buildSqlDatabaseUrlWithPassword({
      provider: "sqlserver",
      databaseUrl:
        "sqlserver://db.example.com:1433;database=local_playground;user=db-user;encrypt=true",
      password: "new-password",
    });

    expect(resolved).toBe(
      "sqlserver://db.example.com:1433;database=local_playground;user=db-user;encrypt=true;password=new-password",
    );
  });

  it("throws for provider and URL mismatch", () => {
    expect(() => {
      buildSqlDatabaseUrlWithPassword({
        provider: "mysql",
        databaseUrl: "file:/tmp/local-playground.sqlite",
        password: "token-value",
      });
    }).toThrow("must use the mysql scheme");
  });
});
