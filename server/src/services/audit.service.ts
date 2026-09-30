import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";

import prisma from "../config/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { logger } from "../utils/logger.js";
import { buildPaginationMeta, type PaginationParams } from "../utils/pagination.js";

// Audit trail for admin and security-sensitive actions. The middleware below
// remembers who is calling and from where for the rest of the request, so
// services only say what changed: recordAudit({ action, entityType, ... }).

interface AuditContext {
  ip: string | undefined;
  userAgent: string | undefined;
  actor?: { id: string; email: string } | undefined;
}

const context = new AsyncLocalStorage<AuditContext>();

/** Mounted once in app.ts, before the routes. */
export function auditContext(req: Request, _res: Response, next: NextFunction) {
  context.run({ ip: req.ip, userAgent: req.get("user-agent")?.slice(0, 300) }, next);
}

/** Called by authenticate once the user is known. */
export function setAuditActor(actor: { id: string; email: string }) {
  const store = context.getStore();
  if (store) store.actor = actor;
}

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null | undefined;
  before?: unknown;
  after?: unknown;
  reason?: string | null | undefined;
  /** Defaults to the signed-in user of the current request. */
  actor?: { id: string; email: string } | null | undefined;
}

/** JSON-safe copy (Decimals and Dates become strings) without secrets. */
function snapshot(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(
    JSON.stringify(value, (key, field) => (["passwordHash", "tokenHash", "inviteToken"].includes(key) ? undefined : field))
  ) as Prisma.InputJsonValue;
}

type AuditClient = Pick<typeof prisma, "auditLog">;

/**
 * Writes one audit entry. Pass the transaction client to make the entry part
 * of the change itself; otherwise a failure is logged and never undoes the
 * action that was already done.
 */
export async function recordAudit(entry: AuditEntry, client?: AuditClient) {
  const store = context.getStore();
  const actor = entry.actor === undefined ? store?.actor : entry.actor;

  const data = {
    actorId: actor?.id ?? null,
    actorEmail: actor?.email ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: snapshot(entry.before) ?? Prisma.DbNull,
    after: snapshot(entry.after) ?? Prisma.DbNull,
    reason: entry.reason ?? null,
    ip: store?.ip ?? null,
    userAgent: store?.userAgent ?? null,
  } satisfies Prisma.AuditLogUncheckedCreateInput;

  if (client) {
    await client.auditLog.create({ data });
    return;
  }

  try {
    await prisma.auditLog.create({ data });
  } catch (error) {
    logger.error({ err: error, action: entry.action }, "Audit log write failed");
  }
}

/** Only the fields that changed, for compact before/after entries. */
export function changedFields<T extends Record<string, unknown>>(before: T, after: T) {
  const keys = Object.keys(after).filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])
  );
  return {
    before: Object.fromEntries(keys.map((key) => [key, before[key]])),
    after: Object.fromEntries(keys.map((key) => [key, after[key]])),
  };
}

export interface AuditFilters {
  actorId?: string | undefined;
  action?: string | undefined;
  entityType?: string | undefined;
  entityId?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
}

export async function listAuditLogs(filters: AuditFilters, pagination: PaginationParams) {
  const where: Prisma.AuditLogWhereInput = {
    ...(filters.actorId && { actorId: filters.actorId }),
    // "venue." matches every venue action.
    ...(filters.action && (filters.action.endsWith(".") ? { action: { startsWith: filters.action } } : { action: filters.action })),
    ...(filters.entityType && { entityType: filters.entityType }),
    ...(filters.entityId && { entityId: filters.entityId }),
    ...((filters.from || filters.to) && {
      createdAt: { ...(filters.from && { gte: filters.from }), ...(filters.to && { lt: filters.to }) },
    }),
  };

  const [items, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: pagination.skip,
      take: pagination.limit,
      include: { actor: { select: { id: true, name: true, role: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { items, pagination: buildPaginationMeta(pagination, total) };
}

/** Distinct action names seen so far, for the filter dropdown. */
export async function listAuditActions() {
  const rows = await prisma.auditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } });
  return rows.map((row) => row.action);
}
