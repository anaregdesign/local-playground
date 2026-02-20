import { DEFAULT_AGENT_INSTRUCTION } from "~/lib/constants";
import { readAzureArmUserContext } from "~/lib/server/auth/azure-user";
import {
  ensurePersistenceDatabaseReady,
  prisma,
} from "~/lib/server/persistence/prisma";
import { getOrCreateUserByIdentity } from "~/lib/server/persistence/user";
import { readThreadSnapshotFromUnknown } from "~/lib/home/thread/parsers";
import { buildThreadMcpServerRowId } from "~/lib/home/thread/server-ids";
import type { ThreadSnapshot } from "~/lib/home/thread/types";
import type { Route } from "./+types/api.threads";

const THREAD_NAME_MAX_LENGTH = 80;
const THREAD_DEFAULT_NAME = "New Thread";

type ThreadAction = "create" | "save";

export async function loader({ request }: Route.LoaderArgs) {
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
    if (threads.length > 0) {
      return Response.json({ threads });
    }

    const created = await createThread(user.id);
    return Response.json({ threads: [created] });
  } catch (error) {
    return Response.json(
      {
        error: `Failed to load threads from database: ${readErrorMessage(error)}`,
      },
      { status: 500 },
    );
  }
}

export async function action({ request }: Route.ActionArgs) {
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
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const actionType = readThreadAction(payload);
  if (!actionType) {
    return Response.json(
      {
        error: '`action` must be either "create" or "save".',
      },
      { status: 400 },
    );
  }

  try {
    if (actionType === "create") {
      const created = await createThread(user.id, readOptionalThreadName(payload));
      return Response.json({ thread: created });
    }

    const thread = readThreadSnapshotFromSavePayload(payload);
    if (!thread) {
      return Response.json({ error: "Invalid thread payload." }, { status: 400 });
    }

    const saved = await saveThreadSnapshot(user.id, thread);
    if (!saved) {
      return Response.json({ error: "Thread is not available." }, { status: 404 });
    }

    return Response.json({ thread: saved });
  } catch (error) {
    return Response.json(
      {
        error: `Failed to update thread in database: ${readErrorMessage(error)}`,
      },
      { status: 500 },
    );
  }
}

async function createThread(userId: number, rawName = ""): Promise<ThreadSnapshot> {
  await ensurePersistenceDatabaseReady();

  const now = new Date().toISOString();
  const name = normalizeThreadName(rawName) || THREAD_DEFAULT_NAME;
  const id = createRandomId();

  await prisma.$transaction(async (transaction) => {
    await transaction.thread.create({
      data: {
        id,
        userId,
        name,
        createdAt: now,
        updatedAt: now,
      },
    });

    await transaction.threadInstruction.create({
      data: {
        threadId: id,
        content: DEFAULT_AGENT_INSTRUCTION,
      },
    });
  });

  const created = await readThreadById(userId, id);
  if (!created) {
    throw new Error("Failed to create thread.");
  }

  return created;
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

  const existing = await prisma.thread.findFirst({
    where: {
      id: snapshot.id,
      userId,
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (!existing) {
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
          id: entry.id,
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
  });

  return await readThreadById(userId, existing.id);
}

function mapStoredThreadToSnapshot(value: {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
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
}): ThreadSnapshot | null {
  const parsed = readThreadSnapshotFromUnknown(
    {
      id: value.id,
      name: value.name,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
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
  if (action === "create" || action === "save") {
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

function readOptionalThreadName(value: unknown): string {
  if (!isRecord(value) || typeof value.name !== "string") {
    return "";
  }

  return value.name;
}

function normalizeThreadName(value: string): string {
  return value.trim().slice(0, THREAD_NAME_MAX_LENGTH);
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

function createRandomId(): string {
  const maybeCrypto = globalThis.crypto;
  if (maybeCrypto && typeof maybeCrypto.randomUUID === "function") {
    return maybeCrypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
