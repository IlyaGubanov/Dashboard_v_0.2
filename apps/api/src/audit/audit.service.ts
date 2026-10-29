import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  userId?: number | null;
  action: AuditAction;
  entity: string;
  entityId?: string | number | null;
  directionId?: number | null;
  siteId?: number | null;
  before?: unknown;
  after?: unknown;
  comment?: string | null;
  ip?: string | null;
}

/** Журнал изменений. Пишется в той же транзакции, что и изменение, если передан tx. */
@Injectable()
export class AuditService {
  private readonly log = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async write(e: AuditEntry, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    try {
      await db.auditLog.create({
        data: {
          userId: e.userId ?? null,
          action: e.action,
          entity: e.entity,
          entityId: e.entityId == null ? null : String(e.entityId),
          directionId: e.directionId ?? null,
          siteId: e.siteId ?? null,
          before: toJson(e.before),
          after: toJson(e.after),
          comment: e.comment ?? null,
          ip: e.ip ?? null,
        },
      });
    } catch (err) {
      // внутри транзакции ошибка журнала должна откатить изменение
      if (tx) throw err;
      this.log.error(`Не удалось записать журнал: ${(err as Error).message}`);
    }
  }
}

function toJson(v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (v === undefined || v === null) return Prisma.DbNull;
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)));
}
