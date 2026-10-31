// Explicitly opt-in, isolated QA DB only. Never run against an operational database.
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { SecretBox } from '../apps/api/src/video/video-domain';
const url = process.env.VIDEO_TEST_DATABASE_URL ?? '';
if (!/^mysql:\/\/[^/]+\/video_test(?:\?.*)?$/.test(url)) throw new Error('Use an isolated database named video_test');
if (!process.env.VIDEO_QA_SOURCE_HOST) throw new Error('VIDEO_QA_SOURCE_HOST must be the actual local test-source address');
const sourcePort = Number(process.env.VIDEO_QA_SOURCE_PORT ?? 8554);
if (!Number.isInteger(sourcePort) || sourcePort < 1 || sourcePort > 65535) throw new Error('Invalid VIDEO_QA_SOURCE_PORT');
const db = new PrismaClient({ datasourceUrl: url });
async function main() {
try {
  const admin = await db.user.upsert({ where: { login: 'video-qa-admin' }, create: { login: 'video-qa-admin', fullName: 'Администратор · ТЕСТ', canLogin: true, globalRole: 'ADMIN', passwordHash: await hash('VideoTest2026local', 10), mustChangePassword: false },
    update: { mustChangePassword: false } });
  const schools = await db.site.findMany({ where: { direction: { code: 'schools' } }, orderBy: { id: 'asc' } });
  if (schools.length < 3) throw new Error('Seed demo schools first');
  for (const login of ['video-qa-viewer', 'video-qa-no-video']) {
    const user = await db.user.upsert({ where: { login }, create: { login, fullName: login + ' · ТЕСТ', canLogin: true, passwordHash: await hash('VideoTest2026local', 10), mustChangePassword: false }, update: { mustChangePassword: false } });
    await db.directionMember.upsert({ where: { directionId_userId: { directionId: schools[0].directionId, userId: user.id } }, create: { directionId: schools[0].directionId, userId: user.id, role: 'VIEWER' }, update: {} });
    if (login === 'video-qa-viewer') await db.videoGrant.upsert({ where: { userId_siteId: { userId: user.id, siteId: schools[0].id } }, create: { userId: user.id, siteId: schools[0].id }, update: {} });
  }
  const box = new SecretBox(process.env.VIDEO_ENCRYPTION_KEY ?? '');
  for (let i = 0; i < 3; i++) {
    let recorder = await db.videoRecorder.findFirst({ where: { siteId: schools[i].id, name: 'ТЕСТ · генератор H.264' } });
    if (!recorder) recorder = await db.videoRecorder.create({ data: { siteId: schools[i].id, name: 'ТЕСТ · генератор H.264', host: process.env.VIDEO_QA_SOURCE_HOST!, port: sourcePort,
      username: 'qa-viewer', passwordEncrypted: box.encrypt('qa-fixture-only'), enabled: i !== 2, createdById: admin.id, updatedById: admin.id } });
    for (let channel = 1; channel <= (i === 0 ? 12 : i === 1 ? 2 : 1); channel++) {
      if (await db.videoCamera.findFirst({ where: { recorderId: recorder.id, channel } })) continue;
      await db.videoCamera.create({ data: { recorderId: recorder.id, name: 'ТЕСТ · ' + (['Вход', 'Фасад', 'Двор', 'Коридор'][((channel - 1) % 4)]) + ' · ' + channel,
        channel, activeChannel: i === 0 && channel === 11 ? null : channel, isArchived: i === 0 && channel === 11,
        enabled: !(i === 0 && channel === 12), sort: channel, createdById: admin.id, updatedById: admin.id } });
    }
  }
  console.log('QA fixture ready: 3 TEST recorders, 15 cameras (14 non-archived), first school 11 visible, one disabled camera and one disabled recorder.');
} finally { await db.$disconnect(); }
}
void main().catch(error => { console.error(error.message); process.exitCode = 1; });
