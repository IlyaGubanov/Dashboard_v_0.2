/**
 * Вложения: фото и документы к объектам (паспорт) и к событиям замечаний («устранено» — с фото).
 *
 * Файлы лежат на диске (FILES_DIR, в Docker — том files_data), в базе — описание.
 * Имя на диске случайное; тип определяется по расширению из белого списка и сверяется с началом файла,
 * чтобы под видом картинки нельзя было загрузить страницу или программу.
 * Удаление = архив: файл скрывается, но остаётся на диске.
 */
import { BadRequestException, ForbiddenException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, stat, unlink } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Attachment as AttachmentRow } from '@prisma/client';
import { ATTACHMENT_EXT, ATTACHMENT_MAX_MB, type Attachment, type AttachmentEntity, type FleetKind } from '@mvs/shared';
import { store } from '../fleet/fleet-store';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../auth/access.service';
import type { AuthUser } from '../common/request';

export const FILES_DIR = resolve(process.env.FILES_DIR ?? 'data/files');
const ATTACH_HOURS = 24;

type Ext = (typeof ATTACHMENT_EXT)[number];
const MIME: Record<Ext, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  dwg: 'application/acad',
};
const hex = (s: string) => Buffer.from(s.replace(/ /g, ''), 'hex');
const OLE = hex('D0CF11E0A1B11AE1');
const ZIP = hex('504B0304');
/** Сигнатуры начала файла: [смещение, байты]. Нет записи — проверка не нужна (текст, чертёж). */
const MAGIC: Partial<Record<Ext, [number, Buffer][][]>> = {
  jpg: [[[0, hex('FFD8FF')]]],
  jpeg: [[[0, hex('FFD8FF')]]],
  png: [[[0, hex('89504E470D0A1A0A')]]],
  gif: [[[0, Buffer.from('GIF8')]]],
  webp: [[[0, Buffer.from('RIFF')], [8, Buffer.from('WEBP')]]],
  heic: [[[4, Buffer.from('ftyp')]]],
  pdf: [[[0, Buffer.from('%PDF')]]],
  doc: [[[0, OLE]]],
  xls: [[[0, OLE]]],
  ppt: [[[0, OLE]]],
  docx: [[[0, ZIP]]],
  xlsx: [[[0, ZIP]]],
  pptx: [[[0, ZIP]]],
  zip: [[[0, ZIP]]],
  rar: [[[0, Buffer.from('Rar!')]]],
  '7z': [[[0, hex('377ABCAF271C')]]],
};
/** Показываются в браузере; остальное — только скачивание. */
const INLINE = new Set<Ext>(['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf']);
const IMAGE = new Set<Ext>(['jpg', 'jpeg', 'png', 'webp', 'gif']);

const extOf = (name: string) => (name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '') as Ext;

export function toAttachment(f: AttachmentRow & { uploadedBy?: { fullName: string } | null }, canArchive: boolean): Attachment {
  return {
    id: f.id,
    fileName: f.fileName,
    mimeType: f.mimeType,
    size: f.size,
    isImage: IMAGE.has(extOf(f.fileName)),
    uploadedBy: f.uploadedBy?.fullName ?? null,
    createdAt: f.createdAt.toISOString(),
    canArchive,
    visibility: f.visibility as 'GENERAL'|'FINANCE'|'LIABILITY',
  };
}

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  /** Объект, к которому относится вложение, и может ли пользователь добавлять файлы. */
  private async target(user: AuthUser, entity: AttachmentEntity, entityId: number) {
    if (entity.startsWith('fleet_')) {
      this.access.assertSection(user,'fleet');
      const d=await this.prisma.direction.findFirst({where:{code:'reb',isActive:true}});
      if(!d) throw new NotFoundException('Направление РЭБ недоступно');
      await this.access.assertViewDirection(user,d.id);
      const kind=(entity==='fleet_liability'?'incidents':entity.slice(6)) as FleetKind;
      if(!['vehicles','incidents','fines','tolls','requests'].includes(kind)) throw new BadRequestException('Неизвестный тип вложения РЭБ');
      const row=await store(this.prisma,kind).findFirst({where:{id:entityId,directionId:d.id}});
      if(!row) throw new NotFoundException('Запись РЭБ не найдена');
      const manager=await this.access.canManageDirection(user,d.id);
      if(['fleet_fines','fleet_tolls','fleet_liability'].includes(entity)) this.access.assertFeature(user,'finance');
      if(entity==='fleet_liability'&&!manager) throw new ForbiddenException('Нужны права куратора РЭБ');
      const m=await this.access.membership(user,d.id);
      const editor=m?.role==='EDITOR'&&(m.scope==='ALL'||(typeof row.siteId==='number'&&await this.access.canEditSite(user,row.siteId)));
      return {siteId:null,directionId:d.id,canUpload:!d.isReadonly&&!row.isArchived&&(manager||editor),label:'запись РЭБ'};
    }
    if (entity === 'site') {
      const s = await this.prisma.site.findUnique({ where: { id: entityId }, select: { id: true, directionId: true, isArchived: true } });
      if (!s) throw new NotFoundException('Объект не найден');
      await this.access.assertViewDirection(user, s.directionId);
      return { siteId: s.id, directionId: s.directionId, canUpload: !s.isArchived && (await this.access.canEditSite(user, s.id)), label: 'паспорт объекта' };
    }
    if (entity === 'remark_event') {
      const e = await this.prisma.remarkEvent.findUnique({ where: { id: entityId }, include: { remark: { select: { siteId: true, directionId: true, num: true } } } });
      if (!e) throw new NotFoundException('Событие не найдено');
      await this.access.assertViewDirection(user, e.remark.directionId);
      // фото прикладывает автор события — сразу после него (например, «устранено» + фото)
      const canUpload = e.authorId === user.id && Date.now() - e.createdAt.getTime() < ATTACH_HOURS * 3600_000;
      return { siteId: e.remark.siteId, directionId: e.remark.directionId, canUpload, label: `замечание № ${e.remark.num}` };
    }
    throw new BadRequestException('Неизвестный тип вложения');
  }

  async list(user: AuthUser, entity: AttachmentEntity, entityId: number): Promise<{ files: Attachment[]; canUpload: boolean }> {
    const t = await this.target(user, entity, entityId);
    const manager = await this.access.canManageDirection(user, t.directionId);
    const files = await this.prisma.attachment.findMany({
      where: { entity, entityId, isArchived: false, ...(entity.startsWith('fleet_')?{visibility:{in:['GENERAL',...(this.access.has(user,'finance')?['FINANCE']:[]),...(manager&&this.access.has(user,'finance')?['LIABILITY']:[])]}}:{}) },
      include: { uploadedBy: { select: { fullName: true } } },
      orderBy: { id: 'asc' },
    });
    return { files: files.map((f) => toAttachment(f, manager || f.uploadedById === user.id)), canUpload: t.canUpload };
  }

  async upload(user: AuthUser, entity: AttachmentEntity, entityId: number, rawName: string, body: Readable, ip: string | null, visibility?:'GENERAL'|'FINANCE'|'LIABILITY'): Promise<Attachment> {
    const t = await this.target(user, entity, entityId);
    if (!t.canUpload) throw new ForbiddenException('Нет прав добавлять файлы сюда');
    const scope=entity==='fleet_liability'?'LIABILITY':entity==='fleet_fines'||entity==='fleet_tolls'?'FINANCE':visibility??(entity.startsWith('fleet_')?'FINANCE':'GENERAL');
    if(scope!=='GENERAL') this.access.assertFeature(user,'finance');
    if(scope==='LIABILITY') await this.access.assertManageDirection(user,t.directionId);
    const fileName = rawName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 200);
    const ext = extOf(fileName);
    if (!fileName || !(ATTACHMENT_EXT as readonly string[]).includes(ext)) {
      throw new BadRequestException(`Такой тип файла не принимается. Можно: ${ATTACHMENT_EXT.join(', ')}`);
    }

    const now = new Date();
    const rel = join(String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'), `${randomBytes(16).toString('hex')}.${ext}`);
    const full = join(FILES_DIR, rel);
    await mkdir(dirname(full), { recursive: true });

    const max = ATTACHMENT_MAX_MB * 1024 * 1024;
    let size = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _e, cb) {
        size += chunk.length;
        if (size > max) cb(new PayloadTooLargeException(`Файл больше ${ATTACHMENT_MAX_MB} МБ`));
        else cb(null, chunk);
      },
    });
    try {
      await pipeline(body, limit, createWriteStream(full, { flags: 'wx' }));
      if (size === 0) throw new BadRequestException('Пустой файл');
      await this.checkMagic(full, ext);
    } catch (e) {
      await unlink(full).catch(() => undefined);
      throw e;
    }

    const row = await this.prisma.attachment.create({
      data: { siteId: t.siteId, entity, entityId, visibility:scope, fileName, mimeType: MIME[ext], size, storagePath: rel.replace(/\\/g, '/'), uploadedById: user.id },
      include: { uploadedBy: { select: { fullName: true } } },
    });
    await this.audit.write({ userId: user.id, action: 'CREATE', entity: entity.startsWith('fleet_')?'fleet_attachment':'attachment', entityId: row.id, directionId: t.directionId, siteId: t.siteId, ip, comment: `файл «${fileName}» (${t.label})`, after: { file: fileName, visibility:scope, targetEntity:entity, targetId:entityId } });
    return toAttachment(row, true);
  }

  private async checkMagic(path: string, ext: Ext) {
    const variants = MAGIC[ext];
    if (!variants) return;
    const fh = await open(path, 'r');
    const head = Buffer.alloc(16);
    try {
      await fh.read(head, 0, 16, 0);
    } finally {
      await fh.close();
    }
    const ok = variants.some((v) => v.every(([off, b]) => head.subarray(off, off + b.length).equals(b)));
    if (!ok) throw new BadRequestException('Содержимое файла не соответствует расширению');
  }

  /** Файл для отдачи: проверка прав, путь и заголовки. */
  async open(user: AuthUser, id: number) {
    const f = await this.prisma.attachment.findUnique({ where: { id } });
    if (!f) throw new NotFoundException('Файл не найден');
    await this.target(user, f.entity as AttachmentEntity, f.entityId);
    await this.checkVisibility(user,f);
    const full = resolve(FILES_DIR, f.storagePath);
    if (!full.startsWith(FILES_DIR + sep)) throw new NotFoundException('Файл не найден');
    const st = await stat(full).catch(() => null);
    if (!st) throw new NotFoundException('Файл не найден на диске');
    const ext = extOf(f.fileName);
    const disp = INLINE.has(ext) ? 'inline' : 'attachment';
    const ascii = f.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
    return {
      stream: createReadStream(full),
      headers: {
        'Content-Type': f.mimeType,
        'Content-Length': String(st.size),
        'Content-Disposition': `${disp}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    };
  }

  async archive(user: AuthUser, id: number, ip: string | null) {
    const f = await this.prisma.attachment.findUnique({ where: { id } });
    if (!f || f.isArchived) throw new NotFoundException('Файл не найден');
    const t = await this.target(user, f.entity as AttachmentEntity, f.entityId);
    await this.checkVisibility(user,f);
    const manager = await this.access.canManageDirection(user, t.directionId);
    if (!manager && f.uploadedById !== user.id) throw new ForbiddenException('Убрать файл может тот, кто его добавил, или куратор');
    await this.prisma.attachment.update({ where: { id }, data: { isArchived: true } });
    await this.audit.write({ userId: user.id, action: 'DELETE', entity: f.entity.startsWith('fleet_')?'fleet_attachment':'attachment', entityId: id, directionId: t.directionId, siteId: t.siteId, ip, comment: `файл «${f.fileName}» убран в архив (${t.label})`, before: { file: f.fileName, visibility:f.visibility, targetEntity:f.entity, targetId:f.entityId } });
    return { ok: true };
  }
  private async checkVisibility(user:AuthUser,file:AttachmentRow) {
    if(!file.entity.startsWith('fleet_'))return;
    if(file.visibility!=='GENERAL')this.access.assertFeature(user,'finance');
    if(file.visibility==='LIABILITY') {
      const d=await this.prisma.direction.findUniqueOrThrow({where:{code:'reb'}});
      await this.access.assertManageDirection(user,d.id);
    }
  }
}
