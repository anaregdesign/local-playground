/**
 * Tests for persistence database configuration helpers.
 */
import { describe, expect, it } from "vitest";
import {
  buildPostgresDatabaseUrlWithPassword,
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
      postgresAuthentication: null,
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
    expect(config.postgresAuthentication).toEqual({
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
    expect(config.postgresAuthentication).toEqual({
      method: "password",
    });
  });

  it("uses azure identity authentication for postgres when configured", () => {
    const config = resolvePersistenceDatabaseConfig({
      env: {
        LOCAL_PLAYGROUND_DATABASE_PROVIDER: "postgresql",
        LOCAL_PLAYGROUND_POSTGRES_HOST: "db.example.com",
        LOCAL_PLAYGROUND_POSTGRES_DATABASE: "local_playground",
        LOCAL_PLAYGROUND_POSTGRES_USER: "db-user",
        LOCAL_PLAYGROUND_POSTGRES_AUTH_METHOD: "azure_identity",
        LOCAL_PLAYGROUND_POSTGRES_AZURE_IDENTITY_CLIENT_ID:
          "00000000-0000-0000-0000-000000000000",
        LOCAL_PLAYGROUND_POSTGRES_AZURE_IDENTITY_SCOPE:
          "https://ossrdbms-aad.database.windows.net/.default",
      },
    });

    expect(config.postgresAuthentication).toEqual({
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
        LOCAL_PLAYGROUND_POSTGRES_AUTH_METHOD: "access_token",
        LOCAL_PLAYGROUND_POSTGRES_ACCESS_TOKEN: "postgres-token",
      },
    });

    expect(config.postgresAuthentication).toEqual({
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

  it("throws when postgres auth method is invalid", () => {
    expect(() => {
      resolvePersistenceDatabaseConfig({
        env: {
          LOCAL_PLAYGROUND_DATABASE_PROVIDER: "postgresql",
          LOCAL_PLAYGROUND_POSTGRES_HOST: "db.example.com",
          LOCAL_PLAYGROUND_POSTGRES_DATABASE: "local_playground",
          LOCAL_PLAYGROUND_POSTGRES_USER: "db-user",
          LOCAL_PLAYGROUND_POSTGRES_AUTH_METHOD: "invalid",
        },
      });
    }).toThrow("LOCAL_PLAYGROUND_POSTGRES_AUTH_METHOD");
  });

  it("throws when access token auth is selected without token", () => {
    expect(() => {
      resolvePersistenceDatabaseConfig({
        env: {
          LOCAL_PLAYGROUND_DATABASE_PROVIDER: "postgresql",
          LOCAL_PLAYGROUND_POSTGRES_HOST: "db.example.com",
          LOCAL_PLAYGROUND_POSTGRES_DATABASE: "local_playground",
          LOCAL_PLAYGROUND_POSTGRES_USER: "db-user",
          LOCAL_PLAYGROUND_POSTGRES_AUTH_METHOD: "access_token",
        },
      });
    }).toThrow("LOCAL_PLAYGROUND_POSTGRES_ACCESS_TOKEN");
  });
});

describe("buildPostgresDatabaseUrlWithPassword", () => {
  it("injects password into postgres URLs", () => {
    const resolved = buildPostgresDatabaseUrlWithPassword(
      "postgresql://db-user@db.example.com:5432/local_playground?sslmode=require",
      "token-value",
    );

    expect(resolved).toBe(
      "postgresql://db-user:token-value@db.example.com:5432/local_playground?sslmode=require",
    );
  });

  it("throws for non-postgres URLs", () => {
    expect(() => {
      buildPostgresDatabaseUrlWithPassword("file:/tmp/local-playground.sqlite", "token-value");
    }).toThrow("PostgreSQL database URL is required");
  });
});
