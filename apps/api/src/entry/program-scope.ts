import type { Prisma } from '@prisma/client';

/** Единая область программы для листа ввода, причин и проверки закрытия отчёта. */
export function reportProgramScope(program: string, periodId: number): Prisma.SiteWhereInput {
  return { OR: [{ section: { code: program } }, { reports: { some: { periodId } } }, { workItems: { some: { progress: { some: { periodId } } } } }, { sectionId: null, reports: { some: { period: { program } } } }] };
}
