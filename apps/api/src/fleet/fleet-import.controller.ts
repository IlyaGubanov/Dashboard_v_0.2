import { Body,Controller,Post,Query,Req,PayloadTooLargeException } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators';
import { clientIp,type AuthRequest,type AuthUser } from '../common/request';
import { FleetImportService } from './fleet-import.service';
@Controller('directions/reb/fleet-import')
export class FleetImportController {
  constructor(private readonly s:FleetImportService) {}
  @Post('upload') async upload(@CurrentUser() u:AuthUser,@Query('name') name:string,@Req() req:AuthRequest) {
    // До чтения тела проверяется роль, чтобы незнакомый пользователь не занимал память импортом.
    await this.s.allowed(u);
    const chunks:Buffer[]=[];let size=0;
    for await(const chunk of req) {size+=chunk.length;if(size>8*1024*1024)throw new PayloadTooLargeException('Excel больше 8 МБ');chunks.push(Buffer.from(chunk));}
    return this.s.upload(u,String(name??''),Buffer.concat(chunks));
  }
  @Post('preview') preview(@CurrentUser() u:AuthUser,@Body() b:unknown) {return this.s.preview(u,b);}
  @Post('commit') commit(@CurrentUser() u:AuthUser,@Body() b:unknown,@Req() r:AuthRequest) {return this.s.commit(u,b,clientIp(r));}
}
