import {
  DEFAULT_AGENT_INSTRUCTION,
  HOME_THREAD_NAME_MAX_LENGTH,
  THREAD_DEFAULT_NAME,
} from "~/lib/constants";
import { readAzureArmUserContext } from "~/lib/server/auth/azure-user";
import {
  ensurePersistenceDatabaseReady,
  prisma,
} from "~/lib/server/persistence/prisma";
import { getOrCreateUserByIdentity } from "~/lib/server/persistence/user";
import {
  installGlobalServerErrorLogging,
  logServerRouteEvent,
} from "~/lib/server/observability/app-event-log";
import { readThreadSnapshotFromUnknown } from "~/lib/home/thread/parsers";
import {
  buildThreadMcpRpcLogRowId,
  buildThreadMcpServerRowId,
  buildThreadSkillSelectionRowId,
} from "~/lib/home/thread/server-ids";
import { hasThreadInteraction } from "~/lib/home/thread/snapshot-state";
import type { ThreadSnapshot } from "~/lib/home/thread/types";
import type { Route } from "./+types/api.threads";

type ThreadAction = "save" | "delete" | "restore";

export async function loader({ request }: Route.LoaderArgs) {
  installGlobalServerErrorLogging();

  if (request.method !== "GET") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
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

  try {
    const threads = await readUserThreads(user.id);
    return Response.json({ threads });
  } catch (error) {
    await logServerRouteEvent({
      request,
      route: "/api/threads",
      eventName: "load_threads_failed",
      action: "load_threads",
      statusCode: 500,
      error,
      userId: user.id,
    });

    return Response.json(
      {
        error: `Failed to load threads from database: ${readErrorMessage(error)}`,
      },
      { status: 500 },
    );
  }
}

export async function action({ request }: Route.ActionArgs) {
  installGlobalServerErrorLogging();

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
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

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    await logServerRouteEvent({
      request,
      route: "/api/threads",
      eventName: "invalid_json_body",
      action: "parse_request_body",
      level: "warning",
      statusCode: 400,
      message: "Invalid JSON body.",
      userId: user.id,
    });

    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const actionType = readThreadAction(payload);
  if (!actionType) {
    await logServerRouteEvent({
      request,
      route: "/api/threads",
      eventName: "invalid_action_payload",
      action: "read_action",
      level: "warning",
      statusCode: 400,
      message: '`action` must be one of "save", "delete", or "restore".',
      userId: user.id,
    });

    return Response.json(
      {
        error: '`action` must be one of "save", "delete", or "restore".',
      },
      { status: 400 },
    );
  }

  try {
    if (actionType === "save") {
      const thread = readThreadSnapshotFromSavePayload(payload);
      if (!thread) {
        await logServerRouteEvent({
          request,
          route: "/api/threads",
          eventName: "invalid_thread_payload",
          action: "read_thread_snapshot",
          level: "warning",
          statusCode: 400,
          message: "Invalid thread payload.",
          userId: user.id,
        });

        return Response.json({ error: "Invalid thread payload." }, { status: 400 });
      }

      const saved = await saveThreadSnapshot(user.id, thread);
      if (!saved) {
        await logServerRouteEvent({
          request,
          route: "/api/threads",
          eventName: "thread_not_found",
          action: "save_thread",
          level: "warning",
          statusCode: 404,
          message: "Thread is not available.",
          userId: user.id,
          threadId: thread.id,
        });

        return Response.json({ error: "Thread is not available." }, { status: 404 });
      }

      return Response.json({ thread: saved });
    }

    const threadId = readThreadIdFromActionPayload(payload);
    if (!threadId) {
      await logServerRouteEvent({
        request,
        route: "/api/threads",
        eventName: "invalid_thread_id_payload",
        action: "read_thread_id",
        level: "warning",
        statusCode: 400,
        message: "Invalid thread id payload.",
        userId: user.id,
      });

      return Response.json({ error: "Invalid thread id payload." }, { status: 400 });
    }

    if (actionType === "delete") {
      const deleted = await logicalDeleteThread(user.id, threadId);
      if (deleted.status === "not_found") {
        await logServerRouteEvent({
          request,
          route: "/api/threads",
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
          route: "/api/threads",
          eventName: "thread_delete_disallowed_empty",
          action: "delete_thread",
          level: "warning",
          statusCode: 400,
          message: "Threads without messages cannot be deleted.",
          userId: user.id,
          threadId,
        });

        return Response.json(
          { error: "Threads without messages cannot be deleted." },
          { status: 400 },
        );
      }

      return Response.json({ thread: deleted.thread });
    }

    const restored = await logicalRestoreThread(user.id, threadId);
    if (restored.status === "not_found") {
      await logServerRouteEvent({
        request,
        route: "/api/threads",
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

    return Response.json({ thread: restored.thread });
  } catch (error) {
    const eventName =
      actionType === "save"
        ? "save_thread_failed"
        : actionType === "delete"
          ? "delete_thread_failed"
          : "restore_thread_failed";
    const action =
      actionType === "save"
        ? "save_thread"
        : actionType === "delete"
          ? "delete_thread"
          : "restore_thread";

    await logServerRouteEvent({
      request,
      route: "/api/threads",
      eventName,
      action,
      statusCode: 500,
      error,
      userId: user.id,
    });

    return Response.json(
      {
        error: `Failed to update thread in database: ${readErrorMessage(error)}`,
      },
      { status: 500 },
    );
  }
}

async function readUserThreads(userId: number): Promise<ThreadSnapshot[]> {
  await ensurePersistenceDatabaseReady();

  const records = await prisma.thread.findMany({
    where: {
      userId,
    },
    orderBy: [
      {
        updatedAt: "desc",
      },
      {
        createdAt: "desc",
      },
    ],
    include: {
      instruction: true,
      messages: {
        orderBy: {
          sortOrder: "asc",
        },
      },
      mcpServers: {
        orderBy: {
          sortOrder: "asc",
        },
      },
      mcpRpcLogs: {
        orderBy: {
          sortOrder: "asc",
        },
      },
      skillSelections: {
        orderBy: {
          sortOrder: "asc",
        },
      },
    },
  });

  const threads: ThreadSnapshot[] = [];
  for (const record of records) {
    const snapshot = mapStoredThreadToSnapshot(record);
    if (!snapshot) {
      continue;
    }

    threads.push(snapshot);
  }

  return threads;
}

async function readThreadById(userId: number, threadId: string): Promise<ThreadSnapshot | null> {
  await ensurePersistenceDatabaseReady();

  const record = await prisma.thread.findFirst({
    where: {
      id: threadId,
      userId,
    },
    include: {
      instruction: true,
      messages: {
        orderBy: {
          sortOrder: "asc",
        },
      },
      mcpServers: {
        orderBy: {
          sortOrder: "asc",
        },
      },
      mcpRpcLogs: {
        orderBy: {
          sortOrder: "asc",
        },
      },
      skillSelections: {
        orderBy: {
          sortOrder: "asc",
        },
      },
    },
  });

  if (!record) {
    return null;
  }

  return mapStoredThreadToSnapshot(record);
}

async function saveThreadSnapshot(
  userId: number,
  snapshot: ThreadSnapshot,
): Promise<ThreadSnapshot | null> {
  await ensurePersistenceDatabaseReady();
  if (!hasThreadInteraction(snapshot)) {
    return null;
  }

  let existing = await prisma.thread.findFirst({
    where: {
      id: snapshot.id,
      userId,
    },
    select: {
      id: true,
      name: true,
      deletedAt: true,
    },
  });

  if (!existing) {
    const now = new Date().toISOString();
    const createdAt = snapshot.createdAt || now;
    const nextName = normalizeThreadName(snapshot.name) || THREAD_DEFAULT_NAME;

    await prisma.$transaction(async (transaction) => {
      await transaction.thread.create({
        data: {
          id: snapshot.id,
          userId,
          name: nextName,
          createdAt,
          updatedAt: now,
          deletedAt: null,
        },
      });

      await transaction.threadInstruction.create({
        data: {
          threadId: snapshot.id,
          content: snapshot.agentInstruction,
        },
      });
    });

    existing = {
      id: snapshot.id,
      name: nextName,
      deletedAt: null,
    };
  }

  if (existing.deletedAt !== null) {
    return null;
  }

  const updatedAt = new Date().toISOString();
  const nextName = normalizeThreadName(snapshot.name) || existing.name;

  await prisma.$transaction(async (transaction) => {
    await transaction.thread.update({
      where: {
        id: existing.id,
      },
      data: {
        name: nextName,
        updatedAt,
      },
    });

    await transaction.threadInstruction.upsert({
      where: {
        threadId: existing.id,
      },
      create: {
        threadId: existing.id,
        content: snapshot.agentInstruction,
      },
      update: {
        content: snapshot.agentInstruction,
      },
    });

    await transaction.threadMessage.deleteMany({
      where: {
        threadId: existing.id,
      },
    });

    if (snapshot.messages.length > 0) {
      await transaction.threadMessage.createMany({
        data: snapshot.messages.map((message, index) => ({
          id: message.id,
          threadId: existing.id,
          sortOrder: index,
          role: message.role,
          content: message.content,
          turnId: message.turnId,
          attachmentsJson: JSON.stringify(message.attachments),
        })),
      });
    }

    await transaction.threadMcpServer.deleteMany({
      where: {
        threadId: existing.id,
      },
    });

    if (snapshot.mcpServers.length > 0) {
      await transaction.threadMcpServer.createMany({
        data: snapshot.mcpServers.map((server, index) =>
          server.transport === "stdio"
            ? {
                id: buildThreadMcpServerRowId(existing.id, server.id, index),
                threadId: existing.id,
                sortOrder: index,
                name: server.name,
                transport: server.transport,
                url: null,
                headersJson: null,
                useAzureAuth: false,
                azureAuthScope: null,
                timeoutSeconds: null,
                command: server.command,
                argsJson: JSON.stringify(server.args),
                cwd: server.cwd ?? null,
                envJson: JSON.stringify(server.env),
              }
            : {
                id: buildThreadMcpServerRowId(existing.id, server.id, index),
                threadId: existing.id,
                sortOrder: index,
                name: server.name,
                transport: server.transport,
                url: server.url,
                headersJson: JSON.stringify(server.headers),
                useAzureAuth: server.useAzureAuth,
                azureAuthScope: server.azureAuthScope,
                timeoutSeconds: server.timeoutSeconds,
                command: null,
                argsJson: null,
                cwd: null,
                envJson: null,
              },
        ),
      });
    }

    await transaction.threadMcpRpcLog.deleteMany({
      where: {
        threadId: existing.id,
      },
    });

    if (snapshot.mcpRpcHistory.length > 0) {
      await transaction.threadMcpRpcLog.createMany({
        data: snapshot.mcpRpcHistory.map((entry, index) => ({
          id: buildThreadMcpRpcLogRowId(existing.id, entry.id, index),
          threadId: existing.id,
          sortOrder: index,
          sequence: entry.sequence,
          serverName: entry.serverName,
          method: entry.method,
          startedAt: entry.startedAt,
          completedAt: entry.completedAt,
          requestJson: JSON.stringify(entry.request ?? null),
          responseJson: JSON.stringify(entry.response ?? null),
          isError: entry.isError,
          turnId: entry.turnId,
        })),
      });
    }

    await transaction.threadSkillSelection.deleteMany({
      where: {
        threadId: existing.id,
      },
    });

    if (snapshot.skillSelections.length > 0) {
      await transaction.threadSkillSelection.createMany({
        data: snapshot.skillSelections.map((selection, index) => ({
          id: buildThreadSkillSelectionRowId(existing.id, index),
          threadId: existing.id,
          sortOrder: index,
          skillName: selection.name,
          skillPath: selection.location,
        })),
      });
    }
  });

  return await readThreadById(userId, existing.id);
}

type LogicalDeleteThreadResult =
  | {
      status: "not_found";
    }
  | {
      status: "empty";
    }
  | {
      status: "ok";
      thread: ThreadSnapshot;
    };

async function logicalDeleteThread(
  userId: number,
  threadId: string,
): Promise<LogicalDeleteThreadResult> {
  await ensurePersistenceDatabaseReady();

  const existing = await readThreadById(userId, threadId);
  if (!existing) {
    return { status: "not_found" };
  }
  if (!hasThreadInteraction(existing)) {
    return { status: "empty" };
  }

  if (existing.deletedAt === null) {
    const now = new Date().toISOString();
    await prisma.thread.update({
      where: {
        id: threadId,
      },
      data: {
        deletedAt: now,
        updatedAt: now,
      },
    });
  }

  const deleted = await readThreadById(userId, threadId);
  if (!deleted) {
    return { status: "not_found" };
  }

  return {
    status: "ok",
    thread: deleted,
  };
}

type LogicalRestoreThreadResult =
  | {
      status: "not_found";
    }
  | {
      status: "ok";
      thread: ThreadSnapshot;
    };

async function logicalRestoreThread(
  userId: number,
  threadId: string,
): Promise<LogicalRestoreThreadResult> {
  await ensurePersistenceDatabaseReady();

  const existing = await readThreadById(userId, threadId);
  if (!existing) {
    return { status: "not_found" };
  }

  if (existing.deletedAt !== null) {
    const now = new Date().toISOString();
    await prisma.thread.update({
      where: {
        id: threadId,
      },
      data: {
        deletedAt: null,
        updatedAt: now,
      },
    });
  }

  const restored = await readThreadById(userId, threadId);
  if (!restored) {
    return { status: "not_found" };
  }

  return {
    status: "ok",
    thread: restored,
  };
}

function mapStoredThreadToSnapshot(value: {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  instruction: {
    content: string;
  } | null;
  messages: Array<{
    id: string;
    role: string;
    content: string;
    turnId: string;
    attachmentsJson: string;
  }>;
  mcpServers: Array<{
    id: string;
    name: string;
    transport: string;
    url: string | null;
    headersJson: string | null;
    useAzureAuth: boolean;
    azureAuthScope: string | null;
    timeoutSeconds: number | null;
    command: string | null;
    argsJson: string | null;
    cwd: string | null;
    envJson: string | null;
  }>;
  mcpRpcLogs: Array<{
    id: string;
    sequence: number;
    serverName: string;
    method: string;
    startedAt: string;
    completedAt: string;
    requestJson: string;
    responseJson: string;
    isError: boolean;
    turnId: string;
  }>;
  skillSelections: Array<{
    id: string;
    sortOrder: number;
    skillName: string;
    skillPath: string;
  }>;
}): ThreadSnapshot | null {
  const parsed = readThreadSnapshotFromUnknown(
    {
      id: value.id,
      name: value.name,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      deletedAt: value.deletedAt,
      agentInstruction: value.instruction?.content ?? DEFAULT_AGENT_INSTRUCTION,
      messages: value.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        turnId: message.turnId,
        attachments: readJsonValue(message.attachmentsJson, []),
      })),
      mcpServers: value.mcpServers.map((server) =>
        server.transport === "stdio"
          ? {
              id: server.id,
              name: server.name,
              transport: server.transport,
              command: server.command,
              args: readJsonValue(server.argsJson, []),
              cwd: server.cwd ?? undefined,
              env: readJsonValue(server.envJson, {}),
            }
          : {
              id: server.id,
              name: server.name,
              transport: server.transport,
              url: server.url,
              headers: readJsonValue(server.headersJson, {}),
              useAzureAuth: server.useAzureAuth,
              azureAuthScope: server.azureAuthScope,
              timeoutSeconds: server.timeoutSeconds,
            },
      ),
      mcpRpcHistory: value.mcpRpcLogs.map((entry) => ({
        id: entry.id,
        sequence: entry.sequence,
        serverName: entry.serverName,
        method: entry.method,
        startedAt: entry.startedAt,
        completedAt: entry.completedAt,
        request: readJsonValue(entry.requestJson, null),
        response: readJsonValue(entry.responseJson, null),
        isError: entry.isError,
        turnId: entry.turnId,
      })),
      skillSelections: value.skillSelections.map((selection) => ({
        name: selection.skillName,
        location: selection.skillPath,
      })),
    },
    {
      fallbackInstruction: DEFAULT_AGENT_INSTRUCTION,
    },
  );

  return parsed;
}

function readJsonValue<T>(value: string | null, fallback: T): T {
  if (typeof value !== "string") {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function readThreadAction(value: unknown): ThreadAction | null {
  if (!isRecord(value)) {
    return null;
  }

  const action = value.action;
  if (action === "save" || action === "delete" || action === "restore") {
    return action;
  }

  return null;
}

function readThreadSnapshotFromSavePayload(value: unknown): ThreadSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  return readThreadSnapshotFromUnknown(value.thread, {
    fallbackInstruction: DEFAULT_AGENT_INSTRUCTION,
  });
}

function readThreadIdFromActionPayload(value: unknown): string {
  if (!isRecord(value) || typeof value.threadId !== "string") {
    return "";
  }

  return value.threadId.trim();
}

function normalizeThreadName(value: string): string {
  return value.trim().slice(0, HOME_THREAD_NAME_MAX_LENGTH);
}

async function readAuthenticatedUser(): Promise<{ id: number } | null> {
  const userContext = await readAzureArmUserContext();
  if (!userContext) {
    return null;
  }

  const user = await getOrCreateUserByIdentity({
    tenantId: userContext.tenantId,
    principalId: userContext.principalId,
  });

  return {
    id: user.id,
  };
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
