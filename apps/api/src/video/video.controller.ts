import { Body, Controller, Get, Headers, HttpCode, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { cameraSchema, recorderSchema, videoGrantsSchema, videoStateSchema } from '@mvs/shared';
import type { CameraInput, RecorderInput } from '@mvs/shared';
import { CurrentUser, Public, Roles } from '../auth/decorators';
import type { AuthUser } from '../common/request';
import { ZodPipe } from '../common/zod.pipe';
import { VideoService } from './video.service';
import { validServiceToken } from './media-client';
import { ForbiddenException } from '@nestjs/common';
@Controller('video')
export class VideoController {
  constructor(private readonly video: VideoService) {}
  @Get('catalog') catalog(@CurrentUser() u: AuthUser) { return this.video.catalog(u); }
  @Get('admin/catalog') admin(@CurrentUser() u: AuthUser) { return this.video.catalog(u, true); }
  @Post('recorders') recorder(@CurrentUser() u: AuthUser, @Body(new ZodPipe(recorderSchema)) b: RecorderInput) { return this.video.saveRecorder(u, b); }
  @Put('recorders/:id') editRecorder(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(recorderSchema)) b: RecorderInput) { return this.video.saveRecorder(u, b, id); }
  @Post('cameras') camera(@CurrentUser() u: AuthUser, @Body(new ZodPipe(cameraSchema)) b: CameraInput) { return this.video.saveCamera(u, b); }
  @Put('cameras/:id') editCamera(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(cameraSchema)) b: CameraInput) { return this.video.saveCamera(u, b, id); }
  @Post('recorders/:id/archive') archiveRecorder(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(videoStateSchema)) b: { version: number; isArchived: boolean }) { return this.video.archive(u, 'recorder', id, b.version, b.isArchived); }
  @Post('cameras/:id/archive') archiveCamera(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(videoStateSchema)) b: { version: number; isArchived: boolean }) { return this.video.archive(u, 'camera', id, b.version, b.isArchived); }
  @Throttle({ default: { limit: 12, ttl: 60000 } })
  @Post('recorders/:id/check') checkRecorder(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.video.checkRecorder(u, id); }
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post('cameras/:id/check') checkCamera(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.video.checkCamera(u, id); }
  @Roles('ADMIN') @Get('grants/:userId') grants(@Param('userId', ParseIntPipe) id: number) { return this.video.grants(id); }
  @Roles('ADMIN') @Put('grants/:userId') saveGrants(@CurrentUser() u: AuthUser, @Param('userId', ParseIntPipe) id: number,
    @Body(new ZodPipe(videoGrantsSchema)) body: { grants: { siteId: number; manage: boolean }[] }) { return this.video.saveGrants(u, id, body.grants); }
  // This endpoint is internal in nginx. SessionGuard revalidates live session and rights on EVERY asset.
  @SkipThrottle() @HttpCode(204) @Get('media-auth')
  async mediaAuth(@CurrentUser() u: AuthUser, @Headers('x-original-uri') uri: string) { await this.video.authorizeMedia(u, uri ?? ''); }
  // HTTP callback used ONLY by Control API. HLS is authenticated by nginx and CDN secret.
  @Public() @SkipThrottle() @HttpCode(200) @Post('internal/mediamtx-auth')
  serviceAuth(@Body() b: { token?: unknown; action?: unknown }) {
    if (!validServiceToken(b?.token) || b?.action !== 'api') throw new ForbiddenException();
    return {};
  }
}
