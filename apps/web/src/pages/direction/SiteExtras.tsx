import { useState } from 'react';
import { Button, Group, Skeleton, Stack, Text, UnstyledButton } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { IconPlus } from '@tabler/icons-react';
import { REMARK_CLOSED, type Attachment } from '@mvs/shared';
import { api, directionQueries } from '../../api';
import { AddFiles, Gallery, uploadMany } from '../../ui/attachments';
import { RemarkStatusBadge, SeverityLabel } from '../../ui/RemarkBadges';
import { date } from '../../ui/format';
import { RemarkForm } from './RemarkForm';

/** Замечания объекта в карточке: сначала незакрытые. */
export function SiteRemarks({ code, siteId, onOpen }: { code: string; siteId: number; onOpen: (id: number) => void }) {
  const { data } = useQuery(directionQueries.remarks(code));
  const [creating, setCreating] = useState(false);
  if (!data) return <Skeleton h={160} />;
  const rows = data.rows.filter((r) => r.site.id === siteId).sort((a, b) => Number(REMARK_CLOSED.includes(a.status)) - Number(REMARK_CLOSED.includes(b.status)) || b.num - a.num);
  const canCreate = data.canCreate && data.sites.some((s) => s.id === siteId);
  return (
    <Stack gap="xs">
      {canCreate && (
        <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} style={{ alignSelf: 'flex-start' }} onClick={() => setCreating(true)}>
          Новое замечание по объекту
        </Button>
      )}
      {!rows.length && <Text c="dimmed">Замечаний нет</Text>}
      {rows.map((r) => (
        <UnstyledButton key={r.id} className="row-link" p={8} onClick={() => onOpen(r.id)} style={{ opacity: REMARK_CLOSED.includes(r.status) ? 0.65 : 1 }}>
          <Group justify="space-between" wrap="nowrap" align="flex-start">
            <div style={{ minWidth: 0 }}>
              <Text size="sm" fw={500} lineClamp={2}>
                № {r.num}. {r.text}
              </Text>
              <Group gap="sm" mt={2}>
                <SeverityLabel severity={r.severity} size="xs" />
                <Text size="xs" c={r.overdue ? 'var(--status-critical)' : 'dimmed'} fw={r.overdue ? 700 : 400}>
                  срок {date(r.dueDate)}
                  {r.overdue ? ', просрочено' : ''}
                </Text>
                {r.assignee && (
                  <Text size="xs" c="dimmed">
                    {r.assignee.fullName}
                  </Text>
                )}
              </Group>
            </div>
            <RemarkStatusBadge status={r.status} size="xs" />
          </Group>
        </UnstyledButton>
      ))}
      <RemarkForm code={code} list={data} opened={creating} onClose={() => setCreating(false)} siteId={siteId} onSaved={onOpen} />
    </Stack>
  );
}

/** Фото и документы объекта (акты, схемы, фотофиксация). */
export function SiteFiles({ siteId }: { siteId: number }) {
  const qc = useQueryClient();
  const key = ['attachments', 'site', siteId];
  const { data } = useQuery({ queryKey: key, queryFn: () => api<{ files: Attachment[]; canUpload: boolean }>(`/attachments?entity=site&entityId=${siteId}`) });
  const [busy, setBusy] = useState(false);
  if (!data) return <Skeleton h={120} />;
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  return (
    <Stack gap="sm">
      {data.canUpload && (
        <AddFiles
          busy={busy}
          onFiles={async (files) => {
            setBusy(true);
            await uploadMany('site', siteId, files);
            setBusy(false);
            refresh();
          }}
        />
      )}
      {data.files.length ? <Gallery files={data.files} onChanged={refresh} /> : <Text c="dimmed">Файлов пока нет</Text>}
      {data.files.length > 0 && (
        <Text size="xs" c="dimmed">
          Фото к замечаниям — в карточках замечаний.
        </Text>
      )}
    </Stack>
  );
}
