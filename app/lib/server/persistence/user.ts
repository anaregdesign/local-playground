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
    },
    update: {},
    select: {
      id: true,
      tenantId: true,
      principalId: true,
    },
  });
}
