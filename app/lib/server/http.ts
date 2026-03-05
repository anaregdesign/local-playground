/**
 * Shared HTTP response helpers for API routes.
 */
export type ApiErrorResponseBody = {
  code: string;
  error: string;
};

type ApiErrorResponseOptions = {
  status: number;
  code: string;
  error: string;
  headers?: HeadersInit;
  extras?: Record<string, unknown>;
};

const defaultAuthRequiredMessage = "Azure login is required. Click Azure Login to continue.";

export function errorResponse(options: ApiErrorResponseOptions): Response {
  const { status, code, error, headers, extras } = options;
  return Response.json(
    {
      code,
      error,
      ...(extras ?? {}),
    },
    {
      status,
      headers,
    },
  );
}

export function authRequiredResponse(message = defaultAuthRequiredMessage): Response {
  return errorResponse({
    status: 401,
    code: "auth_required",
    error: message,
    extras: {
      authRequired: true,
    },
  });
}

export function invalidJsonResponse(): Response {
  return errorResponse({
    status: 400,
    code: "invalid_json_body",
    error: "Invalid JSON body.",
  });
}

export function validationErrorResponse(code: string, error: string): Response {
  return errorResponse({
    status: 422,
    code,
    error,
  });
}

export function methodNotAllowedResponse(allowedMethods: readonly string[]): Response {
  return errorResponse({
    status: 405,
    code: "method_not_allowed",
    error: "Method not allowed.",
    headers: {
      Allow: allowedMethods.join(", "),
    },
  });
}
