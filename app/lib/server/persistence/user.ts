/**
 * Server runtime module.
 */
import { ensurePersistenceDatabaseReady, prisma } from "~/lib/server/persistence/prisma";

export type UserIdentity = {
  tenantId: string;
  principalId: string;
};

type PersistedUser = {
  id: number;
  tenantId: string;
  principalId: string;
};

export async function getOrCreateUserByIdentity(
  identity: UserIdentity,
): Promise<PersistedUser> {
  const now = new Date().toISOString();

  await ensurePersistenceDatabaseReady();
  return prisma.workspaceUser.upsert({
    where: {
      tenantId_principalId: {
        tenantId: identity.tenantId,
        principalId: identity.principalId,
      },
    },
    create: {
      tenantId: identity.tenantId,
      principalId: identity.principalId,
      lastUsedAt: now,
    },
    update: {
      lastUsedAt: now,
    },
    select: {
      id: true,
      tenantId: true,
      principalId: true,
    },
  });
}

export async function readMostRecentWorkspaceUserTenantId(): Promise<string> {
  await ensurePersistenceDatabaseReady();

  const mostRecentUser = await prisma.workspaceUser.findFirst({
    where: {
      lastUsedAt: {
        not: "",
      },
    },
    orderBy: [
      { lastUsedAt: "desc" },
      { id: "desc" },
    ],
    select: {
      tenantId: true,
    },
  });

  return mostRecentUser?.tenantId.trim() ?? "";
}
