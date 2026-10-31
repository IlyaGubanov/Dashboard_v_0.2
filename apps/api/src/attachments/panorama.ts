import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';

/** Декодируем только статичные JPEG/PNG/WebP 2:1. Исходник не переписывается. */
export async function preparePanorama(path:string) {
  try {
    const image=sharp(path,{limitInputPixels:64_000_000,failOn:'warning'});
    const m=await image.metadata();
    if(!['jpeg','png','webp'].includes(m.format??'')||(m.pages??1)>1||!m.width||!m.height||m.width<1024||m.width>16384||m.width!==2*m.height)throw new Error('format');
    // libvips сообщает pages не для всех APNG. acTL отличает анимацию от статичного PNG.
    if(m.format==='png'){
      const png=await readFile(path);
      for(let offset=8;offset+12<=png.length;){
        const length=png.readUInt32BE(offset),end=offset+length+12;
        if(end>png.length)throw new Error('png');
        const type=png.toString('ascii',offset+4,offset+8);
        if(type==='acTL')throw new Error('animation');
        if(type==='IEND')break;
        offset=end;
      }
    }
    // Декодирование всех пикселей при создании производных также отклоняет повреждённые файлы.
    await image.clone().resize({width:1200,withoutEnlargement:true}).webp({quality:76}).toFile(`${path}.preview.webp`);
    await image.clone().resize({width:4096,withoutEnlargement:true}).webp({quality:88}).toFile(`${path}.viewer.webp`);
  }catch{
    throw new BadRequestException('Нужна целая сферическая панорама JPEG, PNG или WebP 2:1, шириной от 1024 до 16384 px и до 64 млн пикселей');
  }
}
