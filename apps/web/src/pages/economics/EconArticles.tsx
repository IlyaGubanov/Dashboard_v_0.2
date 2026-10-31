import { useState } from 'react';
import { Alert, Badge, Button, Group, Modal, Paper, Select, Stack, Switch, Table, Text, Textarea, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQueryClient } from '@tanstack/react-query';
import { IconPlus } from '@tabler/icons-react';
import { ECON_ARTICLE_KINDS, ECON_ARTICLE_KIND_LABELS, econArticleSchema, type EconArticle, type EconArticleKind, type EconSetup } from '@mvs/shared';
import { api, ApiError } from '../../api';
import { errorText } from './format';

export function EconArticles({ data }: { data: EconSetup }) {
  const [edit, setEdit] = useState<EconArticle | 'new' | null>(null);
  const canEdit = data.permissions.canEdit;
  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Text size="sm" c="dimmed">Справочник статей расходов. Прямые вносятся по центрам затрат, общепроизводственные и административные — общей суммой за месяц.</Text>
        {canEdit && <Button leftSection={<IconPlus size={16} />} onClick={() => setEdit('new')}>Статья</Button>}
      </Group>
      <Paper withBorder radius="md">
        <Table.ScrollContainer minWidth={640}>
          <Table highlightOnHover verticalSpacing={8} fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Статья</Table.Th>
                <Table.Th w={200}>Вид</Table.Th>
                <Table.Th>Методика установления лимита</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.articles.map((a) => (
                <Table.Tr key={a.id} style={{ cursor: canEdit ? 'pointer' : undefined, opacity: a.isArchived ? 0.6 : undefined }} onClick={() => canEdit && setEdit(a)}>
                  <Table.Td>
                    <Text size="sm" fw={500}>{a.name}</Text>
                    {a.isArchived && <Badge size="xs" color="gray" variant="light">архив</Badge>}
                  </Table.Td>
                  <Table.Td><Badge variant="light" color={a.kind === 'DIRECT' ? 'blue' : 'grape'}>{ECON_ARTICLE_KIND_LABELS[a.kind].label}</Badge></Table.Td>
                  <Table.Td><Text size="xs" c="dimmed" style={{ whiteSpace: 'pre-line' }}>{a.method}</Text></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      {edit && <ArticleDialog article={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </Stack>
  );
}

function ArticleDialog({ article, onClose }: { article: EconArticle | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(article?.name ?? '');
  const [kind, setKind] = useState<EconArticleKind>(article?.kind ?? 'DIRECT');
  const [method, setMethod] = useState(article?.method ?? '');
  const [archived, setArchived] = useState(article?.isArchived ?? false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    const parsed = econArticleSchema.safeParse({ name, kind, method: method.trim() || null, isArchived: archived });
    if (!parsed.success) return setFields(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
    setBusy(true);
    setError('');
    try {
      await api(article ? `/economics/articles/${article.id}` : '/economics/articles', { method: article ? 'PUT' : 'POST', body: parsed.data });
      await qc.invalidateQueries({ queryKey: ['economics'] });
      notifications.show({ color: 'green', message: 'Статья сохранена' });
      onClose();
    } catch (e) {
      if (e instanceof ApiError) setFields(e.fields);
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal opened onClose={onClose} title={article ? 'Статья расходов' : 'Новая статья расходов'} size="lg">
      <Stack gap="sm">
        <TextInput label="Название" value={name} onChange={(e) => setName(e.currentTarget.value)} error={fields.name} required />
        <Select
          label="Вид"
          data={ECON_ARTICLE_KINDS.map((k) => ({ value: k, label: ECON_ARTICLE_KIND_LABELS[k].label }))}
          value={kind}
          onChange={(v) => v && setKind(v as EconArticleKind)}
          description={ECON_ARTICLE_KIND_LABELS[kind].description}
          allowDeselect={false}
          error={fields.kind}
          comboboxProps={{ zIndex: 1000 }}
        />
        <Textarea label="Методика установления лимита" description="Подсказка для ПЭО в карточке лимитов" value={method} onChange={(e) => setMethod(e.currentTarget.value)} autosize minRows={3} maxRows={8} error={fields.method} />
        {article && <Switch label="В архиве (не предлагается в новых лимитах; внесённые данные сохраняются)" checked={archived} onChange={(e) => setArchived(e.currentTarget.checked)} />}
        {error && <Alert color="red">{error}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Отмена</Button>
          <Button loading={busy} onClick={save}>Сохранить</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
