/**
 * Route module for OAuth metadata probe endpoints under /.well-known.
 */
import {
  installGlobalServerErrorLogging,
} from "~/lib/server/observability/runtime-event-log";
import { methodNotAllowedResponse } from "~/lib/server/http";

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
  return methodNotAllowedResponse(["GET"]);
}
