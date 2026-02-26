/**
 * Home runtime support module.
 */
import {
  ENV_KEY_PATTERN,
  THREAD_ENVIRONMENT_KEY_MAX_LENGTH,
  THREAD_ENVIRONMENT_VALUE_MAX_LENGTH,
  THREAD_ENVIRONMENT_VARIABLES_MAX,
} from "~/lib/constants";

export type ThreadEnvironment = Record<string, string>;

type ParseThreadEnvironmentResult =
  | {
      ok: true;
      value: ThreadEnvironment;
    }
  | {
      ok: false;
      error: string;
    };

export function cloneThreadEnvironment(value: ThreadEnvironment): ThreadEnvironment {
  return { ...value };
}

export function readThreadEnvironmentFromUnknown(value: unknown): ThreadEnvironment {
  const parsed = parseThreadEnvironmentFromUnknown(value, {
    strict: false,
    pathLabel: "threadEnvironment",
  });
  return parsed.ok ? parsed.value : {};
}

export function parseThreadEnvironmentFromUnknown(
  value: unknown,
  options: {
    strict?: boolean;
    pathLabel?: string;
  } = {},
): ParseThreadEnvironmentResult {
  const strict = options.strict !== false;
  const pathLabel = options.pathLabel ?? "threadEnvironment";

  if (value === undefined || value === null) {
    return {
      ok: true,
      value: {},
    };
  }

  if (!isRecord(value)) {
    return strict
      ? {
          ok: false,
          error: `\`${pathLabel}\` must be an object.`,
        }
      : {
          ok: true,
          value: {},
        };
  }

  const entries = Object.entries(value);
  if (entries.length > THREAD_ENVIRONMENT_VARIABLES_MAX) {
    if (strict) {
      return {
        ok: false,
        error: `\`${pathLabel}\` can include up to ${THREAD_ENVIRONMENT_VARIABLES_MAX} entries.`,
      };
    }
  }

  const limitedEntries = entries.slice(0, THREAD_ENVIRONMENT_VARIABLES_MAX);
  const environment: ThreadEnvironment = {};
  for (const [key, rawValue] of limitedEntries) {
    if (
      key.length === 0 ||
      key.length > THREAD_ENVIRONMENT_KEY_MAX_LENGTH ||
      !ENV_KEY_PATTERN.test(key)
    ) {
      if (strict) {
        return {
          ok: false,
          error:
            `\`${pathLabel}\` includes an invalid key "${key}". ` +
            `Keys must match ${ENV_KEY_PATTERN.toString()} and be ` +
            `${THREAD_ENVIRONMENT_KEY_MAX_LENGTH} characters or fewer.`,
        };
      }
      continue;
    }

    if (typeof rawValue !== "string") {
      if (strict) {
        return {
          ok: false,
          error: `\`${pathLabel}["${key}"]\` must be a string.`,
        };
      }
      continue;
    }

    if (rawValue.length > THREAD_ENVIRONMENT_VALUE_MAX_LENGTH) {
      if (strict) {
        return {
          ok: false,
          error:
            `\`${pathLabel}["${key}"]\` must be ${THREAD_ENVIRONMENT_VALUE_MAX_LENGTH} characters or fewer.`,
        };
      }
      continue;
    }

    environment[key] = rawValue;
  }

  return {
    ok: true,
    value: environment,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
