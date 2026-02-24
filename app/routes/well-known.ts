/**
 * Route module for OAuth metadata probe endpoints under /.well-known.
 */
import {
  installGlobalServerErrorLogging,
} from "~/lib/server/observability/app-event-log";

const unsupportedMetadataResponse = {
  error: "OAuth metadata is not configured for this Local Playground endpoint.",
  authConfigured: false,
};

export function loader() {
  installGlobalServerErrorLogging();

  return Response.json(
    unsupportedMetadataResponse,
    {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

export function action() {
  installGlobalServerErrorLogging();

  return Response.json(
    {
      error: "Method not allowed.",
    },
    { status: 405 },
  );
}
