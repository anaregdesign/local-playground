/**
 * Shared HTTP response helpers for API routes.
 */
export function methodNotAllowedResponse(allowedMethods: readonly string[]): Response {
  return Response.json(
    {
      error: "Method not allowed.",
    },
    {
      status: 405,
      headers: {
        Allow: allowedMethods.join(", "),
      },
    },
  );
}
