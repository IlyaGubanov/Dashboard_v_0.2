import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { VideoController } from './video.controller';
import { VideoService } from './video.service';
import { VideoSync } from './video-sync';
import { MediaClient } from './media-client';
@Module({ imports: [AuthModule], controllers: [VideoController], providers: [VideoService, VideoSync, MediaClient] })
export class VideoModule {}
