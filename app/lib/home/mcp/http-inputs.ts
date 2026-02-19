export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

import {
  HTTP_HEADER_NAME_PATTERN,
  MCP_AZURE_AUTH_SCOPE_MAX_LENGTH,
  MCP_DEFAULT_AZURE_AUTH_SCOPE,
  MCP_DEFAULT_TIMEOUT_SECONDS,
  MCP_HTTP_HEADERS_MAX,
  MCP_TIMEOUT_SECONDS_MAX,
  MCP_TIMEOUT_SECONDS_MIN,
} from "~/lib/constants";

export function parseHttpHeadersInput(input: string): ParseResult<Record<string, string>> {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: true, value: {} };
  }

  const headers: Record<string, string> = {};
  const lines = input.split(/\r?\n/);
  let count = 0;

  for (const [index, line] of lines.entries()) {
    const lineTrimmed = line.trim();
    if (!lineTrimmed) {
      continue;
    }

    const separatorIndex = lineTrimmed.indexOf("=");
    if (separatorIndex <= 0) {
      return {
        ok: false,
        error: `Header line ${index + 1} must use KEY=value format.`,
      };
    }

    const key = lineTrimmed.slice(0, separatorIndex).trim();
    const value = lineTrimmed.slice(separatorIndex + 1).trim();
    if (!HTTP_HEADER_NAME_PATTERN.test(key)) {
      return {
        ok: false,
        error: `Header line ${index + 1} has invalid key.`,
      };
    }

    if (key.toLowerCase() === "content-type") {
      return {
        ok: false,
        error: 'Header line cannot override "Content-Type". It is fixed to "application/json".',
      };
    }

    headers[key] = value;
    count += 1;
    if (count > MCP_HTTP_HEADERS_MAX) {
      return {
        ok: false,
        error: `Headers can include up to ${MCP_HTTP_HEADERS_MAX} entries.`,
      };
    }
  }

  return { ok: true, value: headers };
}

export function parseAzureAuthScopeInput(input: string): ParseResult<string> {
  const trimmed = input.trim();
  const scope = trimmed || MCP_DEFAULT_AZURE_AUTH_SCOPE;
  if (scope.length > MCP_AZURE_AUTH_SCOPE_MAX_LENGTH) {
    return {
      ok: false,
      error: `Azure auth scope must be ${MCP_AZURE_AUTH_SCOPE_MAX_LENGTH} characters or fewer.`,
    };
  }

  if (/\s/.test(scope)) {
    return {
      ok: false,
      error: "Azure auth scope must not include spaces.",
    };
  }

  return { ok: true, value: scope };
}

export function parseMcpTimeoutSecondsInput(input: string): ParseResult<number> {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: true, value: MCP_DEFAULT_TIMEOUT_SECONDS };
  }

  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) {
    return {
      ok: false,
      error: "MCP timeout must be an integer number of seconds.",
    };
  }

  if (parsed < MCP_TIMEOUT_SECONDS_MIN || parsed > MCP_TIMEOUT_SECONDS_MAX) {
    return {
      ok: false,
      error: `MCP timeout must be between ${MCP_TIMEOUT_SECONDS_MIN} and ${MCP_TIMEOUT_SECONDS_MAX} seconds.`,
    };
  }

  return { ok: true, value: parsed };
}
