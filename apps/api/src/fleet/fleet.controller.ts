import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { FLEET_KINDS, fleetDate, type FleetKind } from '@mvs/shared';
import { CurrentUser } from '../auth/decorators';
import { clientIp, type AuthRequest, type AuthUser } from '../common/request';
import { ZodPipe } from '../common/zod.pipe';
import { FleetService } from './fleet.service';

const kindSchema=z.enum(FLEET_KINDS);
const querySchema=z.object({from:fleetDate.optional(),to:fleetDate.optional(),q:z.string().max(200).optional(),ownership:z.enum(['OWN','RENTED','UNKNOWN']).optional(),kind:z.string().max(100).optional(),status:z.string().max(30).optional(),departmentId:z.coerce.number().int().positive().optional(),targetDirectionId:z.coerce.number().int().positive().optional(),vehicleId:z.coerce.number().int().positive().optional(),archived:z.enum(['true','false']).transform(v=>v==='true').optional(),active:z.enum(['true','false']).transform(v=>v==='true').optional(),page:z.coerce.number().int().min(1).max(100000).optional(),take:z.coerce.number().int().min(1).max(200).optional(),sort:z.string().regex(/^[a-zA-Z]+$/).max(40).optional(),order:z.enum(['asc','desc']).optional()}).strict().refine(v=>!v.from||!v.to||v.from<=v.to,{path:['to'],message:'Окончание периода раньше начала'});
const archiveSchema=z.object({version:z.number().int().positive(),archived:z.boolean()}).strict();

@Controller('directions/reb/fleet')
export class FleetController {
  constructor(private readonly fleet:FleetService) {}
  @Get('refs') refs(@CurrentUser() u:AuthUser) {return this.fleet.refs(u);}
  @Get('overview') overview(@CurrentUser() u:AuthUser,@Query(new ZodPipe(querySchema)) q:z.output<typeof querySchema>) {return this.fleet.overview(u,q);}
  @Get('incidents/:id/liability') liability(@CurrentUser() u:AuthUser,@Param('id',ParseIntPipe) id:number) {return this.fleet.getLiability(u,id);}
  @Post('incidents/:id/liability') saveLiability(@CurrentUser() u:AuthUser,@Param('id',ParseIntPipe) id:number,@Body() b:unknown,@Req() r:AuthRequest) {return this.fleet.saveLiability(u,id,b,clientIp(r));}
  @Get(':kind') list(@CurrentUser() u:AuthUser,@Param('kind',new ZodPipe(kindSchema)) kind:FleetKind,@Query(new ZodPipe(querySchema)) q:z.output<typeof querySchema>) {return this.fleet.list(u,kind,q);}
  @Get(':kind/:id') card(@CurrentUser() u:AuthUser,@Param('kind',new ZodPipe(kindSchema)) kind:FleetKind,@Param('id',ParseIntPipe) id:number) {return this.fleet.card(u,kind,id);}
  @Get(':kind/:id/history') history(@CurrentUser() u:AuthUser,@Param('kind',new ZodPipe(kindSchema)) kind:FleetKind,@Param('id',ParseIntPipe) id:number) {return this.fleet.history(u,kind,id);}
  @Post(':kind') save(@CurrentUser() u:AuthUser,@Param('kind',new ZodPipe(kindSchema)) kind:FleetKind,@Body() b:unknown,@Req() r:AuthRequest) {return this.fleet.save(u,kind,null,b,clientIp(r));}
  @Patch(':kind/:id') update(@CurrentUser() u:AuthUser,@Param('kind',new ZodPipe(kindSchema)) kind:FleetKind,@Param('id',ParseIntPipe) id:number,@Body() b:unknown,@Req() r:AuthRequest) {return this.fleet.save(u,kind,id,b,clientIp(r));}
  @Post(':kind/:id/archive') @HttpCode(200) archive(@CurrentUser() u:AuthUser,@Param('kind',new ZodPipe(kindSchema)) kind:FleetKind,@Param('id',ParseIntPipe) id:number,@Body(new ZodPipe(archiveSchema)) b:z.output<typeof archiveSchema>,@Req() r:AuthRequest) {return this.fleet.archive(u,kind,id,b.version,b.archived,clientIp(r));}
}
