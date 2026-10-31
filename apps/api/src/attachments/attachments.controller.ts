import { BadRequestException, Controller, Get, HttpCode, Param, ParseIntPipe, PayloadTooLargeException, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ATTACHMENT_MAX_MB, type Attachment, type AttachmentEntity } from '@mvs/shared';
import { clientIp, type AuthRequest, type AuthUser } from '../common/request';
import { CurrentUser } from '../auth/decorators';
import { AttachmentsService } from './attachments.service';

const ENTITIES: AttachmentEntity[] = ['site', 'remark_event', 'fleet_vehicles', 'fleet_incidents', 'fleet_fines', 'fleet_tolls', 'fleet_requests', 'fleet_liability'];
function target(entity: string, entityId: string): [AttachmentEntity, number] {
  const id = Number(entityId);
  if (!ENTITIES.includes(entity as AttachmentEntity) || !Number.isInteger(id) || id <= 0) throw new BadRequestException('Неверная ссылка на объект вложения');
  return [entity as AttachmentEntity, id];
}

/**
 * Вложения. Загрузка — телом запроса (application/octet-stream), имя файла — в параметре name:
 * POST /api/attachments?entity=site&entityId=12&name=фото.jpg
 */
@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly s: AttachmentsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query('entity') entity: string, @Query('entityId') entityId: string) {
    return this.s.list(u, ...target(entity, entityId));
  }

  @Post()
  async upload(@CurrentUser() u: AuthUser, @Query('entity') entity: string, @Query('entityId') entityId: string, @Query('name') name: string, @Query('visibility') visibility: string | undefined, @Req() r: AuthRequest): Promise<Attachment> {
    try {
      if ((r.headers['content-type'] ?? '').startsWith('application/json')) throw new BadRequestException('Файл передаётся как application/octet-stream');
      if (Number(r.headers['content-length'] ?? 0) > ATTACHMENT_MAX_MB * 1024 * 1024) throw new PayloadTooLargeException(`Файл больше ${ATTACHMENT_MAX_MB} МБ`);
      if(visibility&&!['GENERAL','FINANCE','LIABILITY'].includes(visibility)) throw new BadRequestException('Неизвестный режим доступа к файлу');
      return await this.s.upload(u, ...target(entity, entityId), String(name ?? ''), r, clientIp(r), visibility as 'GENERAL'|'FINANCE'|'LIABILITY'|undefined);
    } catch (e) {
      // тело запроса могло быть прочитано не до конца — соединение повторно не используем
      r.res?.setHeader('Connection', 'close');
      throw e;
    }
  }

  @Get(':id/file')
  async file(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const f = await this.s.open(u, id);
    res.set(f.headers);
    f.stream.pipe(res);
  }

  @Post(':id/archive')
  @HttpCode(200)
  archive(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Req() r: AuthRequest) {
    return this.s.archive(u, id, clientIp(r));
  }
}
