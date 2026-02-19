import {
  CONTEXT_WINDOW_DEFAULT,
  CONTEXT_WINDOW_MAX,
  CONTEXT_WINDOW_MIN,
} from "~/lib/constants";

export function validateContextWindowInput(input: string): {
  isValid: boolean;
  value: number | null;
  message: string | null;
} {
  const trimmed = input.trim();
  if (!trimmed) {
    return {
      isValid: false,
      value: null,
      message: `Enter an integer between ${CONTEXT_WINDOW_MIN} and ${CONTEXT_WINDOW_MAX}.`,
    };
  }

  if (!/^\d+$/.test(trimmed)) {
    return {
      isValid: false,
      value: null,
      message: "Context window must be an integer.",
    };
  }

  const parsed = Number(trimmed);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < CONTEXT_WINDOW_MIN ||
    parsed > CONTEXT_WINDOW_MAX
  ) {
    return {
      isValid: false,
      value: null,
      message: `Context window must be between ${CONTEXT_WINDOW_MIN} and ${CONTEXT_WINDOW_MAX}.`,
    };
  }

  return {
    isValid: true,
    value: parsed,
    message: null,
  };
}
