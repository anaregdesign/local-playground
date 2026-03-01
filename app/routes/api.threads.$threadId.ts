/**
 * API route module for /api/threads/:threadId.
 */
import { DEFAULT_AGENT_INSTRUCTION } from "~/lib/constants";
import { readThreadSnapshotFromUnknown } from "~/lib/home/thread/parsers";
import { methodNotAllowedResponse } from "~/lib/server/http";
import {
  installGlobalServerErrorLogging,
  logServerRouteEvent,
} from "~/lib/server/observability/runtime-event-log";
import {
  isThreadRestorePayload,
  logicalDeleteThread,
  logicalRestoreThread,
  readAuthenticatedUser,
  readErrorMessage,
  readJsonPayload,
  saveThreadSnapshot,
} from "./api.threads";
import type { Route } from "./+types/api.threads.$threadId";

const THREAD_ITEM_ALLOWED_METHODS = ["PUT", "PATCH", "DELETE"] as const;

export function loader() {
  installGlobalServerErrorLogging();
  return methodNotAllowedResponse(THREAD_ITEM_ALLOWED_METHODS);
}

export async function action({ request, params }: Route.ActionArgs) {
  installGlobalServerErrorLogging();

  if (
    request.method !== "PUT" &&
    request.method !== "DELETE" &&
    request.method !== "PATCH"
  ) {
    return methodNotAllowedResponse(THREAD_ITEM_ALLOWED_METHODS);
  }

  const user = await readAuthenticatedUser();
  if (!user) {
    return Response.json(
      {
        authRequired: true,
        error: "Azure login is required. Click Azure Login to continue.",
      },
      { status: 401 },
    );
  }

  const threadId = typeof params.threadId === "string" ? params.threadId.trim() : "";
  if (!threadId) {
    await logServerRouteEvent({
      request,
      route: "/api/threads/:threadId",
      eventName: "invalid_thread_id_payload",
      action: "read_thread_id",
      level: "warning",
      statusCode: 400,
      message: "Invalid thread id payload.",
      userId: user.id,
    });

    return Response.json({ error: "Invalid thread id payload." }, { status: 400 });
  }

  try {
    if (request.method === "PUT") {
      const payload = await readJsonPayload(request);
      if (!payload.ok) {
        await logServerRouteEvent({
          request,
          route: "/api/threads/:threadId",
          eventName: "invalid_json_body",
          action: "parse_request_body",
          level: "warning",
          statusCode: 400,
          message: "Invalid JSON body.",
          userId: user.id,
          threadId,
        });

        return Response.json({ error: "Invalid JSON body." }, { status: 400 });
      }

      const thread = readThreadSnapshotFromUnknown(payload.value, {
        fallbackInstruction: DEFAULT_AGENT_INSTRUCTION,
      });
      if (!thread) {
        await logServerRouteEvent({
          request,
          route: "/api/threads/:threadId",
          eventName: "invalid_thread_payload",
          action: "read_thread_snapshot",
          level: "warning",
          statusCode: 400,
          message: "Invalid thread payload.",
          userId: user.id,
          threadId,
        });

        return Response.json({ error: "Invalid thread payload." }, { status: 400 });
      }
      if (thread.id !== threadId) {
        await logServerRouteEvent({
          request,
          route: "/api/threads/:threadId",
          eventName: "thread_id_mismatch",
          action: "validate_payload",
          level: "warning",
          statusCode: 400,
          message: "`thread.id` must match path `threadId`.",
          userId: user.id,
          threadId,
          context: {
            payloadThreadId: thread.id,
          },
        });

        return Response.json(
          { error: "`thread.id` must match path `threadId`." },
          { status: 400 },
        );
      }

      const saveResult = await saveThreadSnapshot(user.id, thread);
      if (!saveResult) {
        await logServerRouteEvent({
          request,
          route: "/api/threads/:threadId",
          eventName: "thread_not_found",
          action: "save_thread",
          level: "warning",
          statusCode: 404,
          message: "Thread is not available.",
          userId: user.id,
          threadId,
        });

        return Response.json({ error: "Thread is not available." }, { status: 404 });
      }

      const status = saveResult.created ? 201 : 200;
      await logServerRouteEvent({
        request,
        route: "/api/threads/:threadId",
        eventName: "save_thread_succeeded",
        action: "save_thread",
        level: "info",
        statusCode: status,
        message: "Thread saved.",
        userId: user.id,
        threadId: saveResult.thread.id,
        context: {
          messageCount: saveResult.thread.messages.length,
          mcpServerCount: saveResult.thread.mcpServers.length,
          operationLogCount: saveResult.thread.mcpRpcLogs.length,
          skillSelectionCount: saveResult.thread.skillSelections.length,
          created: saveResult.created,
        },
      });
      return Response.json(
        { thread: saveResult.thread },
        {
          status,
          headers: saveResult.created
            ? {
                Location: `/api/threads/${encodeURIComponent(saveResult.thread.id)}`,
              }
            : undefined,
        },
      );
    }

    if (request.method === "DELETE") {
      const deleted = await logicalDeleteThread(user.id, threadId);
      if (deleted.status === "not_found") {
        await logServerRouteEvent({
          request,
          route: "/api/threads/:threadId",
          eventName: "thread_not_found",
          action: "delete_thread",
          level: "warning",
          statusCode: 404,
          message: "Thread is not available.",
          userId: user.id,
          threadId,
        });

        return Response.json({ error: "Thread is not available." }, { status: 404 });
      }
      if (deleted.status === "empty") {
        await logServerRouteEvent({
          request,
          route: "/api/threads/:threadId",
          eventName: "thread_delete_disallowed_empty",
          action: "delete_thread",
          level: "warning",
          statusCode: 409,
          message: "Threads without messages cannot be deleted.",
          userId: user.id,
          threadId,
        });

        return Response.json(
          { error: "Threads without messages cannot be deleted." },
          { status: 409 },
        );
      }

      await logServerRouteEvent({
        request,
        route: "/api/threads/:threadId",
        eventName: "delete_thread_succeeded",
        action: "delete_thread",
        level: "info",
        statusCode: 200,
        message: "Thread archived.",
        userId: user.id,
        threadId: deleted.thread.id,
      });
      return Response.json({ thread: deleted.thread });
    }

    const payload = await readJsonPayload(request);
    if (!payload.ok) {
      await logServerRouteEvent({
        request,
        route: "/api/threads/:threadId",
        eventName: "invalid_json_body",
        action: "parse_request_body",
        level: "warning",
        statusCode: 400,
        message: "Invalid JSON body.",
        userId: user.id,
        threadId,
      });

      return Response.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    if (!isThreadRestorePayload(payload.value)) {
      await logServerRouteEvent({
        request,
        route: "/api/threads/:threadId",
        eventName: "invalid_restore_payload",
        action: "validate_payload",
        level: "warning",
        statusCode: 400,
        message: "`archived` must be false.",
        userId: user.id,
        threadId,
      });

      return Response.json({ error: "`archived` must be false." }, { status: 400 });
    }

    const restored = await logicalRestoreThread(user.id, threadId);
    if (restored.status === "not_found") {
      await logServerRouteEvent({
        request,
        route: "/api/threads/:threadId",
        eventName: "thread_not_found",
        action: "restore_thread",
        level: "warning",
        statusCode: 404,
        message: "Thread is not available.",
        userId: user.id,
        threadId,
      });

      return Response.json({ error: "Thread is not available." }, { status: 404 });
    }

    await logServerRouteEvent({
      request,
      route: "/api/threads/:threadId",
      eventName: "restore_thread_succeeded",
      action: "restore_thread",
      level: "info",
      statusCode: 200,
      message: "Thread restored.",
      userId: user.id,
      threadId: restored.thread.id,
    });
    return Response.json({ thread: restored.thread });
  } catch (error) {
    const eventName =
      request.method === "PUT"
        ? "save_thread_failed"
        : request.method === "DELETE"
          ? "delete_thread_failed"
          : "restore_thread_failed";
    const action =
      request.method === "PUT"
        ? "save_thread"
        : request.method === "DELETE"
          ? "delete_thread"
          : "restore_thread";

    await logServerRouteEvent({
      request,
      route: "/api/threads/:threadId",
      eventName,
      action,
      statusCode: 500,
      error,
      userId: user.id,
      threadId,
    });

    return Response.json(
      {
        error: `Failed to update thread in database: ${readErrorMessage(error)}`,
      },
      { status: 500 },
    );
  }
}
