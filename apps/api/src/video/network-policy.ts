import { BlockList, isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { BadRequestException } from '@nestjs/common';

export class NetworkPolicy {
  private readonly block = new BlockList();
  private readonly suffixes: string[];
  private readonly ports: Set<number>;
  constructor(networks = process.env.VIDEO_ALLOWED_NETWORKS ?? '', suffixes = process.env.VIDEO_ALLOWED_DNS_SUFFIXES ?? '', ports = process.env.VIDEO_ALLOWED_PORTS ?? '554') {
    for (const cidr of networks.split(',').map(s => s.trim()).filter(Boolean)) {
      const [address, bits] = cidr.split('/');
      const family = isIP(address);
      if (!family || bits === undefined || !/^\d+$/.test(bits)) throw new Error('VIDEO_ALLOWED_NETWORKS: неверная сеть CIDR');
      this.block.addSubnet(address, Number(bits), family === 4 ? 'ipv4' : 'ipv6');
    }
    this.suffixes = suffixes.toLowerCase().split(',').map(s => s.trim().replace(/^\./, '')).filter(Boolean);
    this.ports = new Set(ports.split(',').map(Number));
  }
  allows(address: string) {
    const family = isIP(address);
    // Never allow loopback, link-local/metadata or multicast through equipment forms.
    if (family === 4 && (/^(127|0|169\.254|22[4-9]|23\d|24\d|25[0-5])\./.test(address))) return false;
    if (family === 6 && /^(::|::1|fe[89ab]|ff|::ffff:)/i.test(address)) return false;
    return !!family && this.block.check(address, family === 4 ? 'ipv4' : 'ipv6');
  }
  async resolve(host: string, port: number): Promise<string> {
    if (!this.ports.has(port)) throw new BadRequestException('RTSP-порт не разрешён настройками сервера');
    if (isIP(host)) {
      if (!this.allows(host)) throw new BadRequestException('Адрес вне разрешённых сетей объектов');
      return host;
    }
    const normalized = host.toLowerCase();
    if (!this.suffixes.some(s => normalized === s || normalized.endsWith('.' + s))) throw new BadRequestException('Внутреннее DNS-имя не разрешено настройками сервера');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const addresses = await Promise.race([
        lookup(normalized, { all: true, verbatim: true }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error()), 3000); }),
      ]);
      if (!addresses.length || addresses.some(a => !this.allows(a.address))) throw new Error();
      // Pin the numeric address. MediaMTX never resolves the user-provided hostname again.
      return addresses[0].address;
    } catch { throw new BadRequestException('DNS-имя недоступно или указывает за пределы разрешённых сетей'); }
    finally { clearTimeout(timer); }
  }
}
