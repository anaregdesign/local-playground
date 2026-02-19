export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export const DEFAULT_MCP_AZURE_AUTH_SCOPE = "https://cognitiveservices.azure.com/.default";
export const DEFAULT_MCP_TIMEOUT_SECONDS = 30;
export const MIN_MCP_TIMEOUT_SECONDS = 1;
export const MAX_MCP_TIMEOUT_SECONDS = 600;

const MAX_MCP_HTTP_HEADERS = 64;
const HTTP_HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const MAX_MCP_AZURE_AUTH_SCOPE_LENGTH = 512;

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
    if (count > MAX_MCP_HTTP_HEADERS) {
      return {
        ok: false,
        error: `Headers can include up to ${MAX_MCP_HTTP_HEADERS} entries.`,
      };
    }
  }

  return { ok: true, value: headers };
}

export function parseAzureAuthScopeInput(input: string): ParseResult<string> {
  const trimmed = input.trim();
  const scope = trimmed || DEFAULT_MCP_AZURE_AUTH_SCOPE;
  if (scope.length > MAX_MCP_AZURE_AUTH_SCOPE_LENGTH) {
    return {
      ok: false,
      error: `Azure auth scope must be ${MAX_MCP_AZURE_AUTH_SCOPE_LENGTH} characters or fewer.`,
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
    return { ok: true, value: DEFAULT_MCP_TIMEOUT_SECONDS };
  }

  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) {
    return {
      ok: false,
      error: "MCP timeout must be an integer number of seconds.",
    };
  }

  if (parsed < MIN_MCP_TIMEOUT_SECONDS || parsed > MAX_MCP_TIMEOUT_SECONDS) {
    return {
      ok: false,
      error: `MCP timeout must be between ${MIN_MCP_TIMEOUT_SECONDS} and ${MAX_MCP_TIMEOUT_SECONDS} seconds.`,
    };
  }

  return { ok: true, value: parsed };
}
