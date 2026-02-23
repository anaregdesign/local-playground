/**
 * Home runtime support module.
 */
export type JsonTokenType =
  | "plain"
  | "key"
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "punctuation";

export type JsonToken = {
  value: string;
  type: JsonTokenType;
};

const jsonTokenCacheLimit = 256;
const tokenizedJsonCache = new Map<string, JsonToken[]>();
const parsedJsonMessageTokenCache = new Map<string, JsonToken[] | null>();

export function formatJsonForDisplay(value: unknown): string {
  const normalizedValue = normalizeJsonStringValue(value);
  try {
    return JSON.stringify(normalizedValue, null, 2);
  } catch {
    return String(normalizedValue);
  }
}

export function parseJsonMessageTokens(content: string): JsonToken[] | null {
  const cached = readParsedJsonMessageTokenCache(content);
  if (cached.hit) {
    return cached.value;
  }

  const trimmed = content.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    writeParsedJsonMessageTokenCache(content, null);
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    writeParsedJsonMessageTokenCache(content, null);
    return null;
  }

  const formatted = JSON.stringify(parsed, null, 2);
  const tokens = tokenizeJson(formatted);
  writeParsedJsonMessageTokenCache(content, tokens);
  return tokens;
}

export function isJsonCodeClassName(className: string | undefined): boolean {
  if (!className) {
    return false;
  }

  return /\blanguage-json\b/i.test(className) || /\blanguage-jsonc\b/i.test(className);
}

export function tokenizeJson(input: string): JsonToken[] {
  const cached = readTokenizedJsonCache(input);
  if (cached) {
    return cached;
  }

  const pattern =
    /"(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(?=\s*:)|"(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}[\],:]/g;
  const tokens: JsonToken[] = [];
  let lastIndex = 0;

  for (const match of input.matchAll(pattern)) {
    const tokenIndex = match.index ?? 0;
    const tokenValue = match[0];

    if (tokenIndex > lastIndex) {
      tokens.push({
        value: input.slice(lastIndex, tokenIndex),
        type: "plain",
      });
    }

    tokens.push({
      value: tokenValue,
      type: classifyJsonToken(input, tokenIndex, tokenValue),
    });

    lastIndex = tokenIndex + tokenValue.length;
  }

  if (lastIndex < input.length) {
    tokens.push({
      value: input.slice(lastIndex),
      type: "plain",
    });
  }

  writeTokenizedJsonCache(input, tokens);
  return tokens;
}

function normalizeJsonStringValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function classifyJsonToken(
  source: string,
  tokenIndex: number,
  tokenValue: string,
): JsonTokenType {
  if (tokenValue === "true" || tokenValue === "false") {
    return "boolean";
  }
  if (tokenValue === "null") {
    return "null";
  }
  if (/^-?\d/.test(tokenValue)) {
    return "number";
  }
  if (/^[\[\]{}:,]$/.test(tokenValue)) {
    return "punctuation";
  }
  if (tokenValue.startsWith('"')) {
    return isJsonKeyToken(source, tokenIndex, tokenValue.length) ? "key" : "string";
  }
  return "plain";
}

function isJsonKeyToken(source: string, tokenIndex: number, tokenLength: number): boolean {
  let cursor = tokenIndex + tokenLength;
  while (cursor < source.length && /\s/.test(source[cursor])) {
    cursor += 1;
  }
  return source[cursor] === ":";
}

function readTokenizedJsonCache(input: string): JsonToken[] | null {
  const cached = tokenizedJsonCache.get(input);
  if (!cached) {
    return null;
  }
  tokenizedJsonCache.delete(input);
  tokenizedJsonCache.set(input, cached);
  return cached;
}

function writeTokenizedJsonCache(input: string, tokens: JsonToken[]): void {
  tokenizedJsonCache.set(input, tokens);
  trimTokenCache(tokenizedJsonCache);
}

function readParsedJsonMessageTokenCache(
  input: string,
): {
  hit: boolean;
  value: JsonToken[] | null;
} {
  if (!parsedJsonMessageTokenCache.has(input)) {
    return {
      hit: false,
      value: null,
    };
  }

  const cached = parsedJsonMessageTokenCache.get(input) ?? null;
  parsedJsonMessageTokenCache.delete(input);
  parsedJsonMessageTokenCache.set(input, cached);
  return {
    hit: true,
    value: cached,
  };
}

function writeParsedJsonMessageTokenCache(input: string, tokens: JsonToken[] | null): void {
  parsedJsonMessageTokenCache.set(input, tokens);
  trimTokenCache(parsedJsonMessageTokenCache);
}

function trimTokenCache<T>(cache: Map<string, T>): void {
  while (cache.size > jsonTokenCacheLimit) {
    const oldest = cache.keys().next();
    if (oldest.done) {
      return;
    }
    cache.delete(oldest.value);
  }
}
