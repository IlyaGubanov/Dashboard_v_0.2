import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccessService } from '../auth/access.service';
import { KpiService } from '../kpi/kpi.service';
import { ObjectsMapService } from '../map/map.service';
import type { AuthUser } from '../common/request';
import type { AttachmentsService } from './attachments.service';

const url=process.env.PANORAMA_TEST_DATABASE_URL;
const db=url?new PrismaService({datasourceUrl:url}):null;
describe.skipIf(!url)('панорамы: исходники, права, история и карта',()=>{
  let service:AttachmentsService,map:ObjectsMapService,root:string,dirId:number,siteId:number,userId:number,viewerId:number,outsiderId:number,original:Buffer;
  let admin:AuthUser,viewer:AuthUser,outsider:AuthUser;
  const code=`qa_pano_${Date.now().toString(36)}`;
  beforeAll(async()=>{
    const target=new URL(url!);
    if(!['127.0.0.1','localhost'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw new Error('Только локальная тестовая БД');
    root=await mkdtemp(join(tmpdir(),'mvs-pano-test-'));process.env.FILES_DIR=root;
    const {AttachmentsService}=await import('./attachments.service');
    dirId=(await db!.direction.create({data:{code,name:'Панорамы',shortName:'Панорамы',periodKind:'DAY',progressMethod:'SIMPLE_AVERAGE',planMethod:'NONE'}})).id;
    siteId=(await db!.site.create({data:{directionId:dirId,code:'site',name:'Проверяемый объект',lat:55.75,lon:37.62}})).id;
    userId=(await db!.user.create({data:{fullName:'QA администратор'}})).id;
    viewerId=(await db!.user.create({data:{fullName:'QA наблюдатель'}})).id;
    outsiderId=(await db!.user.create({data:{fullName:'QA без доступа'}})).id;
    await db!.directionMember.create({data:{directionId:dirId,userId:viewerId,role:'VIEWER'}});
    admin={id:userId,login:'qa',fullName:'QA',globalRole:'ADMIN',sessionId:-1,mustChangePassword:false,hiddenSections:[],deniedFeatures:[]};
    viewer={...admin,id:viewerId,globalRole:'USER'};outsider={...viewer,id:outsiderId};
    const access=new AccessService(db!);service=new AttachmentsService(db!,new AuditService(db!),access);map=new ObjectsMapService(db!,new KpiService(db!,access),access);
    original=await sharp({create:{width:1024,height:512,channels:3,background:'#426886'}}).jpeg().toBuffer();
  });
  afterAll(async()=>{
    if(dirId)await db!.direction.delete({where:{id:dirId}});
    if(userId)await db!.user.deleteMany({where:{id:{in:[userId,viewerId,outsiderId]}}});
    await db?.$disconnect();
    if(root&&resolve(root).startsWith(resolve(tmpdir())+sep)&&basename(root).startsWith('mvs-pano-test-'))await rm(root,{recursive:true});
  });
  const upload=(date:string,description='Сферическая панорама')=>service.upload(admin,'site',siteId,'panorama.jpg',Readable.from(original),null,{materialType:'PANORAMA360',capturedOn:date,description});
  const bytes=async(stream:Readable)=>{const chunks:Buffer[]=[];for await(const part of stream)chunks.push(Buffer.from(part));return Buffer.concat(chunks);};
  it('сохраняет JPEG без увеличения и отделяет дату съёмки от загрузки',async()=>{
    const f=await upload('2026-01-01');
    expect(f).toMatchObject({materialType:'PANORAMA360',capturedOn:'2026-01-01',description:'Сферическая панорама',uploadedBy:'QA администратор'});
    expect(f.createdAt.slice(0,10)).not.toBe(f.capturedOn);
    const saved=await bytes((await service.open(admin,f.id)).stream);
    expect(await sharp(saved).metadata()).toMatchObject({format:'jpeg',width:1024,height:512});
    expect(f.size).toBe(saved.length);
    const preview=await service.open(admin,f.id,'preview');
    expect(preview.headers['Content-Type']).toBe('image/webp');
    expect((await sharp(await bytes(preview.stream)).metadata()).width).toBeLessThanOrEqual(1200);
  });
  it('не принимает обычное фото, подделку, недопустимую дату и событие замечания как панораму',async()=>{
    const square=await sharp({create:{width:600,height:600,channels:3,background:'#345678'}}).jpeg().toBuffer();
    await expect(service.upload(admin,'site',siteId,'square.jpg',Readable.from(square),null,{materialType:'PANORAMA360',capturedOn:'2026-01-01'})).rejects.toThrow();
    await expect(service.upload(admin,'site',siteId,'fake.jpg',Readable.from(Buffer.from('FFD8FFwrong','hex')),null,{materialType:'PANORAMA360',capturedOn:'2026-01-01'})).rejects.toThrow();
    await expect(upload('2026-02-31')).rejects.toThrow();
    expect((await db!.attachment.findMany({where:{siteId}})).map(f=>f.fileName)).not.toContain('square.jpg');
  });
  it('возвращает историю и выбирает последнее фото по съёмке, затем по добавлению',async()=>{
    await upload('2026-02-01','Новый снимок');await upload('2025-01-01','Загружен позже, снят раньше');const latest=await upload('2026-02-01','Вторая точка той же даты');
    const list=await service.list(viewer,'site',siteId);
    expect(list.files.filter(f=>f.materialType==='PANORAMA360')).toHaveLength(4);
    expect((await map.list(viewer)).sites.find(s=>s.id===siteId)?.panorama).toMatchObject({id:latest.id,capturedOn:'2026-02-01',count:4});
    expect(JSON.stringify(await map.list(viewer))).not.toContain('storagePath');
  });
  it('сохраняет обычные вложения и запрещает чтение/загрузку без прав',async()=>{
    const f=await service.upload(admin,'site',siteId,'old-photo.jpg',Readable.from(original),null);
    expect(f.materialType).toBe('FILE');
    expect(await bytes((await service.open(viewer,f.id)).stream)).toEqual(original);
    await expect(service.open(outsider,f.id)).rejects.toThrow();
    await expect(service.upload(viewer,'site',siteId,'denied.jpg',Readable.from(original),null,{materialType:'PANORAMA360',capturedOn:'2026-01-01'})).rejects.toThrow();
    await service.archive(admin,f.id,null);await expect(service.open(viewer,f.id)).rejects.toThrow();
  });
  it('ограничивает панорамы 50 МБ и убирает недописанные файлы',async()=>{
    await expect(service.upload(admin,'site',siteId,'large.jpg',Readable.from(Buffer.alloc(51*1024*1024)),null,{materialType:'PANORAMA360',capturedOn:'2026-01-01'})).rejects.toThrow();
    const rows=await db!.attachment.count({where:{siteId}});
    const files=await readdir(root,{recursive:true});
    const originals=files.filter(p=>String(p).endsWith('.jpg'));
    expect(originals).toHaveLength(rows);
  });
  it('отклоняет APNG даже когда декодер не сообщает число кадров',async()=>{
    const png=await sharp({create:{width:1024,height:512,channels:3,background:'#426886'}}).png().toBuffer();
    const animated=apng(png);
    expect((await sharp(animated).metadata()).pages).toBeUndefined();
    await expect(service.upload(admin,'site',siteId,'animated.png',Readable.from(animated),null,{materialType:'PANORAMA360',capturedOn:'2026-01-01'})).rejects.toThrow();
  });
  it('принимает 11904 × 5952, сохраняет три оптимизированные версии и прежнюю дату съёмки',async()=>{
    const large=await sharp({create:{width:11904,height:5952,channels:3,background:'#426886'}}).jpeg().toBuffer();
    const f=await service.upload(admin,'site',siteId,'camera.jpg',Readable.from(large),null,{materialType:'PANORAMA360',capturedOn:'2026-10-15'});
    const saved=await bytes((await service.open(admin,f.id)).stream);
    expect(f).toMatchObject({capturedOn:'2026-10-15',mimeType:'image/jpeg',size:saved.length});
    expect(await sharp(saved).metadata()).toMatchObject({format:'jpeg',width:8192,height:4096});
    expect(await sharp(await bytes((await service.open(admin,f.id,'viewer')).stream)).metadata()).toMatchObject({width:4096,height:2048});
    expect(await sharp(await bytes((await service.open(admin,f.id,'preview')).stream)).metadata()).toMatchObject({width:1200,height:600});
    const stored=await db!.attachment.findUniqueOrThrow({where:{id:f.id}});
    const files=(await readdir(root,{recursive:true})).map(String);
    expect(files.filter(p=>p.includes(basename(stored.storagePath).split('.')[0]))).toHaveLength(3);
  },30000);
  it('преобразует PNG в JPEG и не оставляет файл исходного формата',async()=>{
    const png=await sharp(original).png().toBuffer();
    const f=await service.upload(admin,'site',siteId,'small.png',Readable.from(png),null,{materialType:'PANORAMA360',capturedOn:'2026-10-16'});
    expect(f).toMatchObject({fileName:'small.jpg',mimeType:'image/jpeg'});
    expect(await sharp(await bytes((await service.open(admin,f.id)).stream)).metadata()).toMatchObject({format:'jpeg',width:1024,height:512});
  });
  it('откатывает запись и удаляет все файлы при ошибке сохранения в БД',async()=>{
    const beforeRows=await db!.attachment.count({where:{siteId}});
    const beforeFiles=(await readdir(root,{recursive:true})).map(String).sort();
    await expect(service.upload({...admin,id:2147483647},'site',siteId,'rollback.jpg',Readable.from(original),null,{materialType:'PANORAMA360',capturedOn:'2026-10-17'})).rejects.toThrow();
    expect(await db!.attachment.count({where:{siteId}})).toBe(beforeRows);
    expect((await readdir(root,{recursive:true})).map(String).sort()).toEqual(beforeFiles);
  });
  it('принимает панораму больше прежнего лимита 25 МБ и сохраняет только оптимизированные файлы',async()=>{
    const padded=Buffer.concat([original,Buffer.alloc(26*1024*1024)]);
    const file=await service.upload(admin,'site',siteId,'large.jpg',Readable.from(padded),null,{materialType:'PANORAMA360',capturedOn:'2026-02-01'});
    expect(file.size).toBeLessThan(1024*1024);
    expect(await sharp(await bytes((await service.open(admin,file.id)).stream)).metadata()).toMatchObject({format:'jpeg',width:1024,height:512});
  });
  it('не принимает финансовый режим доступа РЭБ для панорам и файлов объекта',async()=>{
    const before=await db!.attachment.count({where:{siteId}});
    for(const visibility of ['FINANCE','LIABILITY'] as const){
      await expect(service.upload(admin,'site',siteId,'private.jpg',Readable.from(original),null,{materialType:'PANORAMA360',capturedOn:'2026-02-01'},visibility)).rejects.toMatchObject({status:400});
      await expect(service.upload(admin,'site',siteId,'private.jpg',Readable.from(original),null,visibility)).rejects.toMatchObject({status:400});
    }
    expect(await db!.attachment.count({where:{siteId}})).toBe(before);
  });
});

/** Два одинаковых кадра: валидный APNG, а не поддельная сигнатура. */
function apng(png:Buffer){
  const crc=(b:Buffer)=>{let c=0xffffffff;for(const v of b){c^=v;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;};
  const chunk=(t:string,d:Buffer)=>{const b=Buffer.alloc(d.length+12);b.writeUInt32BE(d.length);b.write(t,4);d.copy(b,8);b.writeUInt32BE(crc(b.subarray(4,-4)),b.length-4);return b;};
  const parts:{t:string;d:Buffer}[]=[];
  for(let o=8;o<png.length;){const n=png.readUInt32BE(o);parts.push({t:png.toString('ascii',o+4,o+8),d:png.subarray(o+8,o+8+n)});o+=n+12;}
  const ihdr=parts.find(p=>p.t==='IHDR')!.d,idat=Buffer.concat(parts.filter(p=>p.t==='IDAT').map(p=>p.d));
  const ac=Buffer.alloc(8);ac.writeUInt32BE(2);
  const ctl=(seq:number)=>{const d=Buffer.alloc(26);d.writeUInt32BE(seq);ihdr.copy(d,4,0,8);d.writeUInt16BE(1,20);d.writeUInt16BE(10,22);return d;};
  const fd=Buffer.alloc(idat.length+4);fd.writeUInt32BE(2);idat.copy(fd,4);
  return Buffer.concat([png.subarray(0,8),chunk('IHDR',ihdr),chunk('acTL',ac),chunk('fcTL',ctl(0)),chunk('IDAT',idat),chunk('fcTL',ctl(1)),chunk('fdAT',fd),chunk('IEND',Buffer.alloc(0))]);
}
