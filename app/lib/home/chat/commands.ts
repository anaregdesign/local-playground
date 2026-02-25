/**
 * Home runtime support module.
 */

export type ChatCommandMatch = {
  keyword: string;
  query: string;
  rangeStart: number;
  rangeEnd: number;
};

type ReadChatCommandMatchAtCursorOptions = {
  value: string;
  cursorIndex: number;
  keywords: readonly string[];
};

type ReplaceChatCommandTokenOptions = {
  value: string;
  rangeStart: number;
  rangeEnd: number;
  replacement: string;
};

export function readChatCommandMatchAtCursor(
  options: ReadChatCommandMatchAtCursorOptions,
): ChatCommandMatch | null {
  const { value, keywords } = options;
  if (keywords.length === 0 || value.length === 0) {
    return null;
  }

  const cursorIndex = clampCursorIndex(options.cursorIndex, value.length);
  const rangeStart = readTokenStart(value, cursorIndex);
  const rangeEnd = readTokenEnd(value, rangeStart);
  if (cursorIndex <= rangeStart || cursorIndex > rangeEnd) {
    return null;
  }

  const keyword = value.slice(rangeStart, rangeStart + 1);
  if (!keyword || !keywords.includes(keyword)) {
    return null;
  }

  if (rangeStart > 0) {
    const previous = value.slice(rangeStart - 1, rangeStart);
    if (!isTokenBoundary(previous)) {
      return null;
    }
  }

  return {
    keyword,
    query: value.slice(rangeStart + 1, rangeEnd),
    rangeStart,
    rangeEnd,
  };
}

export function replaceChatCommandToken(
  options: ReplaceChatCommandTokenOptions,
): { value: string; cursorIndex: number } {
  const { value, replacement } = options;
  const rangeStart = clampCursorIndex(options.rangeStart, value.length);
  const rangeEnd = Math.max(rangeStart, clampCursorIndex(options.rangeEnd, value.length));

  const before = value.slice(0, rangeStart);
  let after = value.slice(rangeEnd);
  let insertedJoin = "";

  if (replacement.length === 0) {
    const beforeEndsInlineWhitespace = /[ \t]$/.test(before);
    const afterStartsInlineWhitespace = /^[ \t]/.test(after);

    if (beforeEndsInlineWhitespace && afterStartsInlineWhitespace) {
      after = after.replace(/^[ \t]+/, "");
    } else if (
      !beforeEndsInlineWhitespace &&
      !afterStartsInlineWhitespace &&
      before.length > 0 &&
      after.length > 0
    ) {
      insertedJoin = " ";
    }
  }

  const nextValue = `${before}${replacement}${insertedJoin}${after}`;
  return {
    value: nextValue,
    cursorIndex: before.length + replacement.length + insertedJoin.length,
  };
}

function clampCursorIndex(value: number, max: number): number {
  if (!Number.isFinite(value)) {
    return max;
  }

  if (value <= 0) {
    return 0;
  }

  if (value >= max) {
    return max;
  }

  return Math.floor(value);
}

function readTokenStart(value: string, cursorIndex: number): number {
  let index = cursorIndex;
  while (index > 0) {
    const previous = value.slice(index - 1, index);
    if (isTokenBoundary(previous)) {
      break;
    }

    index -= 1;
  }

  return index;
}

function readTokenEnd(value: string, startIndex: number): number {
  let index = startIndex;
  while (index < value.length) {
    const current = value.slice(index, index + 1);
    if (isTokenBoundary(current)) {
      break;
    }

    index += 1;
  }

  return index;
}

function isTokenBoundary(value: string): boolean {
  return /\s/.test(value);
}
