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
import { ATTACHMENT_EXT, ATTACHMENT_MAX_MB, attachmentMaterialSchema, type AttachmentMaterial, type Attachment, type AttachmentEntity } from '@mvs/shared';
import { preparePanorama } from './panorama';
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
    materialType:f.materialType,capturedOn:f.capturedOn?.toISOString().slice(0,10)??null,description:f.description,
    id: f.id,
    fileName: f.fileName,
    mimeType: f.mimeType,
    size: f.size,
    isImage: IMAGE.has(extOf(f.fileName)),
    uploadedBy: f.uploadedBy?.fullName ?? null,
    createdAt: f.createdAt.toISOString(),
    canArchive,
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
    if (entity === 'site') {
      const s = await this.prisma.site.findUnique({ where: { id: entityId }, select: { id: true, directionId: true, isArchived: true } });
      if (!s) throw new NotFoundException('Объект не найден');
      await this.access.assertViewDirection(user, s.directionId);
      return { siteId: s.id, directionId: s.directionId, canUpload: !s.isArchived && (await this.access.canEditSite(user, s.id)), label: 'паспорт объекта' };
    }
    if (entity === 'remark_event') {
      this.access.assertSection(user, 'remarks');
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
      where: { entity, entityId, isArchived: false },
      include: { uploadedBy: { select: { fullName: true } } },
      orderBy: { id: 'asc' },
    });
    return { files: files.map((f) => toAttachment(f, manager || f.uploadedById === user.id)), canUpload: t.canUpload };
  }

  async upload(user: AuthUser, entity: AttachmentEntity, entityId: number, rawName: string, body: Readable, ip: string | null, options:AttachmentMaterial={materialType:'FILE'}): Promise<Attachment> {
    const checked=attachmentMaterialSchema.safeParse(options);
    if(!checked.success)throw new BadRequestException(checked.error.issues[0].message);
    const material=checked.data;
    if(material.materialType==='PANORAMA360'&&entity!=='site')throw new BadRequestException('Панорама относится к объекту');
    const t = await this.target(user, entity, entityId);
    if (!t.canUpload) throw new ForbiddenException('Нет прав добавлять файлы сюда');
    const fileName = rawName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 200);
    const ext = extOf(fileName);
    if(material.materialType==='PANORAMA360'&&!['jpg','jpeg','png','webp'].includes(ext))throw new BadRequestException('Панорама: JPEG, PNG или WebP');
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
      if(material.materialType==='PANORAMA360')await preparePanorama(full);
    } catch (e) {
      await unlink(full).catch(() => undefined);
      await Promise.all(['preview','viewer'].map(v=>unlink(`${full}.${v}.webp`).catch(()=>undefined)));
      throw e;
    }

    const row = await this.prisma.attachment.create({
      data: { siteId: t.siteId, entity, entityId, fileName, mimeType: MIME[ext], size, storagePath: rel.replace(/\\/g, '/'), uploadedById: user.id,
        materialType:material.materialType,...(material.materialType==='PANORAMA360'?{capturedOn:new Date(`${material.capturedOn}T00:00:00Z`),description:material.description||null}:{}) },
      include: { uploadedBy: { select: { fullName: true } } },
    }).catch(async e=>{await Promise.all([full,`${full}.preview.webp`,`${full}.viewer.webp`].map(p=>unlink(p).catch(()=>undefined)));throw e;});
    await this.audit.write({ userId: user.id, action: 'CREATE', entity: 'attachment', entityId: row.id, directionId: t.directionId, siteId: t.siteId, ip, comment: `файл «${fileName}» (${t.label})`, after: { file: fileName, ...material } });
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
  async open(user: AuthUser, id: number, variant:'original'|'preview'|'viewer'='original', download=false) {
    const f = await this.prisma.attachment.findUnique({ where: { id } });
    if (!f || f.isArchived) throw new NotFoundException('Файл не найден');
    await this.target(user, f.entity as AttachmentEntity, f.entityId);
    if(variant!=='original'&&f.materialType!=='PANORAMA360')throw new NotFoundException('Превью не найдено');
    const full = resolve(FILES_DIR, f.storagePath+(variant==='original'?'':`.${variant}.webp`));
    if (!full.startsWith(FILES_DIR + sep)) throw new NotFoundException('Файл не найден');
    const st = await stat(full).catch(() => null);
    if (!st) throw new NotFoundException('Файл не найден на диске');
    const ext = extOf(f.fileName);
    const disp = download?'attachment':INLINE.has(ext)?'inline':'attachment';
    const ascii = f.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
    return {
      stream: createReadStream(full),
      headers: {
        'Content-Type': variant==='original'?f.mimeType:'image/webp',
        'Content-Length': String(st.size),
        'Content-Disposition': `${disp}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
        'Cache-Control': 'private, max-age=0, must-revalidate',
        'ETag': `W/"${id}-${variant}-${st.size}-${st.mtimeMs}"`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    };
  }

  async archive(user: AuthUser, id: number, ip: string | null) {
    const f = await this.prisma.attachment.findUnique({ where: { id } });
    if (!f || f.isArchived) throw new NotFoundException('Файл не найден');
    const t = await this.target(user, f.entity as AttachmentEntity, f.entityId);
    const manager = await this.access.canManageDirection(user, t.directionId);
    if (!manager && f.uploadedById !== user.id) throw new ForbiddenException('Убрать файл может тот, кто его добавил, или куратор');
    await this.prisma.attachment.update({ where: { id }, data: { isArchived: true } });
    await this.audit.write({ userId: user.id, action: 'DELETE', entity: 'attachment', entityId: id, directionId: t.directionId, siteId: t.siteId, ip, comment: `файл «${f.fileName}» убран в архив (${t.label})`, before: { file: f.fileName } });
    return { ok: true };
  }
}
