import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Put, Req } from '@nestjs/common';
import { z } from 'zod';
import {
  assignmentsSchema,
  organizationSchema,
  sectionSchema,
  siteSchema,
  trackerSaveSchema,
  workItemSchema,
  workTypeSchema,
  type ManageRefs,
  type SiteData,
  type SiteEdit,
  type TrackerSaveData,
  type WorkItemData,
} from '@mvs/shared';
import { ZodPipe } from '../common/zod.pipe';
import { clientIp, type AuthRequest, type AuthUser } from '../common/request';
import { CurrentUser } from '../auth/decorators';
import { ManageService } from './manage.service';

const archiveSchema = z.object({ archived: z.boolean() });
type Archive = z.output<typeof archiveSchema>;

/** Управление направлением: объекты, позиции, ответственные, справочники, надстройки. */
@Controller('directions/:code/manage')
export class ManageController {
  constructor(private readonly m: ManageService) {}

  @Get()
  refs(@CurrentUser() u: AuthUser, @Param('code') code: string): Promise<ManageRefs> {
    return this.m.refs(u, code);
  }

  @Get('sites/:id')
  site(@CurrentUser() u: AuthUser, @Param('code') code: string, @Param('id', ParseIntPipe) id: number): Promise<SiteEdit> {
    return this.m.getSite(u, code, id);
  }

  @Post('sites')
  createSite(@CurrentUser() u: AuthUser, @Param('code') code: string, @Body(new ZodPipe(siteSchema)) b: SiteData, @Req() r: AuthRequest) {
    return this.m.createSite(u, code, b, clientIp(r));
  }

  @Patch('sites/:id')
  updateSite(@CurrentUser() u: AuthUser, @Param('code') code: string, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(siteSchema)) b: SiteData, @Req() r: AuthRequest) {
    return this.m.updateSite(u, code, id, b, clientIp(r));
  }

  @Post('sites/:id/archive')
  @HttpCode(200)
  archiveSite(@CurrentUser() u: AuthUser, @Param('code') code: string, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(archiveSchema)) b: Archive, @Req() r: AuthRequest) {
    return this.m.archiveSite(u, code, id, b.archived, clientIp(r));
  }

  @Put('sites/:id/assignments')
  assignments(
    @CurrentUser() u: AuthUser,
    @Param('code') code: string,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodPipe(assignmentsSchema)) b: z.output<typeof assignmentsSchema>,
    @Req() r: AuthRequest,
  ) {
    return this.m.setAssignments(u, code, id, b, clientIp(r));
  }

  @Post('sites/:id/items')
  createItem(@CurrentUser() u: AuthUser, @Param('code') code: string, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(workItemSchema)) b: WorkItemData, @Req() r: AuthRequest) {
    return this.m.createItem(u, code, id, b, clientIp(r));
  }

  @Patch('items/:id')
  updateItem(@CurrentUser() u: AuthUser, @Param('code') code: string, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(workItemSchema)) b: WorkItemData, @Req() r: AuthRequest) {
    return this.m.updateItem(u, code, id, b, clientIp(r));
  }

  @Post('items/:id/archive')
  @HttpCode(200)
  archiveItem(@CurrentUser() u: AuthUser, @Param('code') code: string, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(archiveSchema)) b: Archive, @Req() r: AuthRequest) {
    return this.m.archiveItem(u, code, id, b.archived, clientIp(r));
  }

  @Post('sections')
  createSection(@CurrentUser() u: AuthUser, @Param('code') code: string, @Body(new ZodPipe(sectionSchema)) b: z.output<typeof sectionSchema>, @Req() r: AuthRequest) {
    return this.m.saveSection(u, code, null, b, clientIp(r));
  }

  @Patch('sections/:id')
  updateSection(@CurrentUser() u: AuthUser, @Param('code') code: string, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(sectionSchema)) b: z.output<typeof sectionSchema>, @Req() r: AuthRequest) {
    return this.m.saveSection(u, code, id, b, clientIp(r));
  }

  @Post('sections/:id/archive')
  @HttpCode(200)
  archiveSection(@CurrentUser() u: AuthUser, @Param('code') code: string, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(archiveSchema)) b: Archive, @Req() r: AuthRequest) {
    return this.m.archiveSection(u, code, id, b.archived, clientIp(r));
  }

  @Post('work-types')
  createWorkType(@CurrentUser() u: AuthUser, @Param('code') code: string, @Body(new ZodPipe(workTypeSchema)) b: z.output<typeof workTypeSchema>, @Req() r: AuthRequest) {
    return this.m.saveWorkType(u, code, null, b, clientIp(r));
  }

  @Patch('work-types/:id')
  updateWorkType(@CurrentUser() u: AuthUser, @Param('code') code: string, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(workTypeSchema)) b: z.output<typeof workTypeSchema>, @Req() r: AuthRequest) {
    return this.m.saveWorkType(u, code, id, b, clientIp(r));
  }

  @Post('work-types/:id/archive')
  @HttpCode(200)
  archiveWorkType(@CurrentUser() u: AuthUser, @Param('code') code: string, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(archiveSchema)) b: Archive, @Req() r: AuthRequest) {
    return this.m.archiveWorkType(u, code, id, b.archived, clientIp(r));
  }

  @Post('organizations')
  createOrg(@CurrentUser() u: AuthUser, @Param('code') code: string, @Body(new ZodPipe(organizationSchema)) b: z.output<typeof organizationSchema>, @Req() r: AuthRequest) {
    return this.m.saveOrganization(u, code, null, b, clientIp(r));
  }

  @Patch('organizations/:id')
  updateOrg(@CurrentUser() u: AuthUser, @Param('code') code: string, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(organizationSchema)) b: z.output<typeof organizationSchema>, @Req() r: AuthRequest) {
    return this.m.saveOrganization(u, code, id, b, clientIp(r));
  }

  /** Надстройка по объекту — вносит тот, кто может вносить данные по объекту. */
  @Put('sites/:id/trackers/:tracker')
  saveTracker(
    @CurrentUser() u: AuthUser,
    @Param('code') code: string,
    @Param('id', ParseIntPipe) id: number,
    @Param('tracker') tracker: string,
    @Body(new ZodPipe(trackerSaveSchema)) b: TrackerSaveData,
    @Req() r: AuthRequest,
  ) {
    return this.m.saveTracker(u, code, id, tracker, b, clientIp(r));
  }
}
