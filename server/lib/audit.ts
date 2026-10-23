import { auditLog } from '../db/schema';
import type { DBOrTx } from '../db/client';

export async function audit(
  db: DBOrTx,
  entry: {
    businessId?: string | null;
    userId?: string | null;
    action: string;
    entity: string;
    entityId?: string | null;
    details?: Record<string, unknown>;
  },
) {
  await db.insert(auditLog).values({
    businessId: entry.businessId ?? null,
    userId: entry.userId ?? null,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    details: entry.details ?? {},
  });
}
