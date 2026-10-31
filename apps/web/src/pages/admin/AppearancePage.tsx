import { useState } from 'react';
import {
  ActionIcon,
  Alert,
  Anchor,
  Autocomplete,
  Badge,
  Box,
  Button,
  Card,
  ColorInput,
  Grid,
  Group,
  List,
  SegmentedControl,
  SimpleGrid,
  Slider,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { IconAlertTriangle, IconArrowBackUp, IconCircleCheck } from '@tabler/icons-react';
import {
  APPEARANCE_COLOR_INFO,
  APPEARANCE_COLORS,
  APPEARANCE_FONTS,
  APPEARANCE_GROUP_LABELS,
  appearanceSchema,
  DEFAULT_APPEARANCE,
  NAV_CAPTION_LABELS,
  NAV_CAPTIONS,
  TILE_STYLE_LABELS,
  TILE_STYLES,
  type Appearance,
  type AppearanceColor,
} from '@mvs/shared';
import { api, ApiError } from '../../api';
import { appearanceQuery, forPreview, useAppearance } from '../../ui/appearance';
import { contrast } from '../../ui/color';
import { FactPlanBar } from '../../ui/FactPlanBar';
import { RiskBadge } from '../../ui/RiskBadge';
import { zodValidate } from '../../ui/zodValidate';
import { Metric } from '../../ui/Metric';

type Scheme = 'light' | 'dark';
type TileStyle = Appearance['tiles']['style'];
type NavCaption = Appearance['nav']['caption'];
const SCHEME_LABELS: Record<Scheme, string> = { light: 'Светлая тема', dark: 'Тёмная тема' };
/** Пары «текст / фон», которые должны читаться. 4,5 — для текста, 3 — для значков, линий и графиков. */
const CHECKS: { fg: AppearanceColor; bg: AppearanceColor; min: number; what: string }[] = [
  { fg: 'ink', bg: 'panel', min: 4.5, what: 'основной текст на карточке' },
  { fg: 'ink', bg: 'canvas', min: 4.5, what: 'основной текст на фоне страницы' },
  { fg: 'muted', bg: 'panel', min: 4.5, what: 'подписи на карточке' },
  { fg: 'muted', bg: 'surfaceMuted', min: 4.5, what: 'подписи в шапке таблицы' },
  { fg: 'primary', bg: 'panel', min: 4.5, what: 'ссылки и кнопки на карточке' },
  { fg: 'primary', bg: 'selected', min: 4.5, what: 'выбранный пункт меню' },
  { fg: 'navCaption', bg: 'panel', min: 4.5, what: 'подпись под направлением в меню' },
  { fg: 'ink', bg: 'tileBg', min: 4.5, what: 'число на плитке' },
  { fg: 'muted', bg: 'tileBg', min: 4.5, what: 'подпись на плитке' },
  { fg: 'good', bg: 'panel', min: 3, what: 'значок «в графике»' },
  { fg: 'warning', bg: 'panel', min: 3, what: 'значок «отставание»' },
  { fg: 'critical', bg: 'panel', min: 3, what: 'значок «критично»' },
  { fg: 'series1', bg: 'panel', min: 3, what: 'серия 1 графика' },
  { fg: 'series2', bg: 'panel', min: 3, what: 'серия 2 графика' },
  { fg: 'series3', bg: 'panel', min: 3, what: 'серия 3 графика' },
];

function contrastProblems(a: Appearance) {
  return (['light', 'dark'] as const).flatMap((sc) =>
    CHECKS.flatMap((c) => {
      const r = contrast(a[sc][c.fg], a[sc][c.bg]);
      return r < c.min ? [`${SCHEME_LABELS[sc]}: ${c.what} — контраст ${r.toFixed(1).replace('.', ',')}, нужно от ${String(c.min).replace('.', ',')}`] : [];
    }),
  );
}

/**
 * Оформление приложения: название, шрифт, размеры и цвета. Черновик хранится в AppearanceProvider:
 * он виден во всём приложении (можно перейти в направление и посмотреть), для всех — после сохранения.
 */
export function AppearancePage() {
  const qc = useQueryClient();
  const { saved, draft, setDraft } = useAppearance();
  const v = draft ?? saved;
  const dirty = draft != null;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme('light');

  const set = <K extends keyof Appearance>(k: K, val: Appearance[K]) => {
    setDraft((x) => ({ ...x, [k]: val }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };
  const setColor = (sc: Scheme, k: AppearanceColor, val: string) => {
    setDraft((x) => ({ ...x, [sc]: { ...x[sc], [k]: val } }));
    setErrors((e) => ({ ...e, [`${sc}.${k}`]: '' }));
  };

  const save = async () => {
    const errs = zodValidate<Appearance>(appearanceSchema)(v);
    setErrors(errs);
    if (Object.keys(errs).length) {
      notifications.show({ color: 'red', message: 'Проверьте отмеченные поля' });
      return;
    }
    setSaving(true);
    try {
      await api('/admin/appearance', { method: 'PUT', body: v });
      await qc.invalidateQueries({ queryKey: appearanceQuery.queryKey });
      setDraft(null);
      notifications.show({ color: 'green', message: 'Оформление сохранено и действует для всех пользователей' });
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fields);
        notifications.show({ color: 'red', message: e.message });
      }
    } finally {
      setSaving(false);
    }
  };

  const problems = contrastProblems(forPreview(v, saved));
  const isDefault = JSON.stringify(v) === JSON.stringify(DEFAULT_APPEARANCE);

  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={2}>Оформление</Title>
          <Text c="dimmed" size="sm" maw={760}>
            Название, шрифт, размеры и цвета приложения. Изменения сразу видны у вас во всём приложении — откройте сводку или направление,
            чтобы посмотреть, и вернитесь сюда: черновик не пропадёт. Остальные пользователи увидят изменения после сохранения.
          </Text>
        </div>
        <Group gap="xs">
          {dirty && (
            <Badge color="orange" variant="light">
              не сохранено
            </Badge>
          )}
          <Button variant="default" onClick={() => (setDraft(null), setErrors({}))} disabled={!dirty}>
            Отменить изменения
          </Button>
          <Button onClick={save} loading={saving} disabled={!dirty}>
            Сохранить для всех
          </Button>
        </Group>
      </Group>

      <Grid gutter="md">
        <Grid.Col span={{ base: 12, lg: 7 }}>
          <Stack>
            <Card withBorder>
              <Stack>
                <Title order={4}>Название в шапке</Title>
                <TextInput
                  label="Название"
                  description="В шапке, на странице входа и в заголовке вкладки браузера"
                  value={v.brandName}
                  onChange={(e) => set('brandName', e.currentTarget.value)}
                  error={errors.brandName}
                />
                <TextInput
                  label="Подпись под названием"
                  description="Можно оставить пустой"
                  value={v.brandCaption}
                  onChange={(e) => set('brandCaption', e.currentTarget.value)}
                  error={errors.brandCaption}
                />
              </Stack>
            </Card>

            <Card withBorder>
              <Stack>
                <Title order={4}>Шрифт и размеры</Title>
                <Autocomplete
                  label="Шрифт"
                  description="Шрифт должен быть установлен на компьютерах пользователей; если его нет — используется Segoe UI или Arial"
                  data={[...APPEARANCE_FONTS]}
                  value={v.fontFamily}
                  onChange={(x) => set('fontFamily', x)}
                  error={errors.fontFamily}
                />
                <SliderField
                  label="Размер текста"
                  hint="Обычный текст; подписи, таблицы и заголовки меняются вместе с ним. Исходный — 14 px"
                  min={12}
                  max={18}
                  marks={[12, 14, 16, 18]}
                  value={v.fontSize}
                  onChange={(x) => set('fontSize', x)}
                />
                <SliderField
                  label="Размер текста в направлениях"
                  hint="Все вкладки направления, карточки объектов и замечаний, ввод данных, плитки и графики — во всех направлениях, в том числе новых. Исходный — 16 px"
                  min={12}
                  max={24}
                  marks={[12, 14, 16, 18, 20, 22, 24]}
                  value={v.directionFontSize}
                  onChange={(x) => set('directionFontSize', x)}
                />
                <SliderField
                  label="Скругление углов"
                  hint="Карточки, кнопки, поля ввода, плитки. 0 — прямые углы. Исходное — 4 px"
                  min={0}
                  max={16}
                  marks={[0, 4, 8, 12, 16]}
                  value={v.radius}
                  onChange={(x) => set('radius', x)}
                />
              </Stack>
            </Card>

            <Card withBorder>
              <Stack>
                <Title order={4}>Плитки показателей</Title>
                <Text size="xs" c="dimmed">
                  Плитки на вкладке «Обзор» направления. Какие плитки показывать, их порядок, подписи и свой цвет — в{' '}
                  <Anchor component={Link} to="/admin/directions" size="xs">
                    «Конструкторе направлений»
                  </Anchor>{' '}
                  → направление → «Плитки обзора». Цвета фона и полосы — ниже, в разделе «Цвета».
                </Text>
                <div>
                  <Text size="sm" fw={600} mb={6}>
                    Вид плитки
                  </Text>
                  <SegmentedControl
                    value={v.tiles.style}
                    onChange={(x) => set('tiles', { ...v.tiles, style: x as TileStyle })}
                    data={TILE_STYLES.map((s) => ({ value: s, label: TILE_STYLE_LABELS[s] }))}
                  />
                </div>
                <SliderField
                  label="Размер числа"
                  hint="Исходный — 16 px"
                  min={14}
                  max={36}
                  marks={[14, 16, 20, 24, 28, 32, 36]}
                  value={v.tiles.valueSize}
                  onChange={(x) => set('tiles', { ...v.tiles, valueSize: x })}
                />
                <SliderField
                  label="Размер подписи"
                  hint="Исходный — 12 px"
                  min={10}
                  max={16}
                  marks={[10, 12, 14, 16]}
                  value={v.tiles.labelSize}
                  onChange={(x) => set('tiles', { ...v.tiles, labelSize: x })}
                />
                <SliderField
                  label="Плиток в ряду"
                  hint="На широком экране; на телефоне — всегда по две. Исходное — 4"
                  unit=""
                  min={2}
                  max={6}
                  marks={[2, 3, 4, 5, 6]}
                  value={v.tiles.columns}
                  onChange={(x) => set('tiles', { ...v.tiles, columns: x })}
                />
              </Stack>
            </Card>

            <Card withBorder>
              <Stack>
                <Title order={4}>Меню направлений</Title>
                <div>
                  <Text size="sm" fw={600}>
                    Подпись под названием направления
                  </Text>
                  <Text size="xs" c="dimmed" mb={6}>
                    Слово после числа («школ», «адресов») задаётся в конструкторе направления: «Основное» → «Как называть объекты»
                  </Text>
                  <SegmentedControl
                    value={v.nav.caption}
                    onChange={(x) => set('nav', { ...v.nav, caption: x as NavCaption })}
                    data={NAV_CAPTIONS.map((s) => ({ value: s, label: NAV_CAPTION_LABELS[s] }))}
                  />
                </div>
                {v.nav.caption !== 'none' && (
                  <SliderField
                    label="Размер подписи"
                    hint="Цвет — в разделе «Цвета» → «Текст и линии». Исходный — 11 px"
                    min={10}
                    max={14}
                    marks={[10, 11, 12, 13, 14]}
                    value={v.nav.captionSize}
                    onChange={(x) => set('nav', { ...v.nav, captionSize: x })}
                  />
                )}
              </Stack>
            </Card>

            <Card withBorder>
              <Stack>
                <Group justify="space-between">
                  <Title order={4}>Цвета</Title>
                  <SegmentedControl
                    size="xs"
                    value={scheme}
                    onChange={(x) => setColorScheme(x as Scheme)}
                    data={[
                      { value: 'light', label: 'Светлая тема' },
                      { value: 'dark', label: 'Тёмная тема' },
                    ]}
                  />
                </Group>
                <Text size="xs" c="dimmed">
                  У светлой и тёмной тем свои цвета. Переключатель меняет тему и у вас в приложении — так сразу видно результат. Цвет можно
                  вписать кодом (#002f6c) или выбрать на палитре.
                </Text>
                {(Object.keys(APPEARANCE_GROUP_LABELS) as (keyof typeof APPEARANCE_GROUP_LABELS)[]).map((g) => (
                  <div key={g}>
                    <Text fw={600} size="sm" mb={6}>
                      {APPEARANCE_GROUP_LABELS[g]}
                    </Text>
                    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                      {APPEARANCE_COLORS.filter((k) => APPEARANCE_COLOR_INFO[k].group === g).map((k) => (
                        <ColorField key={k} scheme={scheme} k={k} value={v[scheme][k]} error={errors[`${scheme}.${k}`]} onChange={(x) => setColor(scheme, k, x)} />
                      ))}
                    </SimpleGrid>
                  </div>
                ))}
              </Stack>
            </Card>

            <Group>
              <Button variant="default" leftSection={<IconArrowBackUp size={16} />} onClick={() => (setDraft(DEFAULT_APPEARANCE), setErrors({}))} disabled={isDefault}>
                Вернуть исходное оформление
              </Button>
              <Text size="xs" c="dimmed">
                Подставит цвета и размеры брендбука; для всех — после «Сохранить для всех»
              </Text>
            </Group>
          </Stack>
        </Grid.Col>

        <Grid.Col span={{ base: 12, lg: 5 }}>
          <Stack style={{ position: 'sticky', top: 72 }}>
            <Sample />
            {problems.length ? (
              <Alert color="orange" icon={<IconAlertTriangle size={18} />} title="Может плохо читаться">
                <List size="sm" spacing={2}>
                  {problems.map((p) => (
                    <List.Item key={p}>{p}</List.Item>
                  ))}
                </List>
              </Alert>
            ) : (
              <Alert color="green" icon={<IconCircleCheck size={18} />}>
                Контраст достаточный в обеих темах: текст и значки читаются.
              </Alert>
            )}
          </Stack>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}

function SliderField({
  label,
  hint,
  unit = ' px',
  min,
  max,
  marks,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  unit?: string;
  min: number;
  max: number;
  marks: number[];
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <Text size="sm" fw={600}>
        {label}: {value}
        {unit}
      </Text>
      <Text size="xs" c="dimmed" mb="xs">
        {hint}
      </Text>
      <Slider
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={onChange}
        marks={marks.map((x) => ({ value: x, label: `${x}` }))}
        label={(x) => `${x}${unit}`}
        aria-label={label}
        mb="lg"
      />
    </div>
  );
}

function ColorField({ scheme, k, value, error, onChange }: { scheme: Scheme; k: AppearanceColor; value: string; error?: string; onChange: (v: string) => void }) {
  const info = APPEARANCE_COLOR_INFO[k];
  const def = DEFAULT_APPEARANCE[scheme][k];
  return (
    <ColorInput
      label={info.label}
      description={info.hint}
      value={value}
      onChange={onChange}
      format="hex"
      error={error}
      swatches={[def]}
      swatchesPerRow={7}
      rightSection={
        value.toLowerCase() !== def ? (
          <Tooltip label={`Вернуть исходный ${def}`}>
            <ActionIcon variant="subtle" color="gray" onClick={() => onChange(def)} aria-label={`Вернуть исходный цвет: ${info.label}`}>
              <IconArrowBackUp size={16} />
            </ActionIcon>
          </Tooltip>
        ) : undefined
      }
    />
  );
}

/** Образец основных элементов в текущем черновике — то, чего может не быть на этой странице. */
function Sample() {
  return (
    <Card withBorder>
      <Stack gap="sm">
        <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
          Образец
        </Text>
        <div>
          <Title order={3}>Заголовок раздела</Title>
          <Text>Обычный текст: 42 адреса, готовность 63,4 %.</Text>
          <Text size="sm" c="dimmed">
            Подпись: данные на 28.10.2026, не проверено куратором
          </Text>
        </div>
        <Group gap="xs">
          <Button size="xs">Основная кнопка</Button>
          <Button size="xs" variant="light">
            Дополнительная
          </Button>
          <Button size="xs" variant="default">
            Обычная
          </Button>
        </Group>
        <Group gap="md">
          <RiskBadge risk="ok" />
          <RiskBadge risk="warn" />
          <RiskBadge risk="crit" />
          <RiskBadge risk="na" />
        </Group>
        <div>
          <Group justify="space-between">
            <Text size="sm" fw={600}>
              Факт 63 %
            </Text>
            <Text size="sm" c="dimmed">
              план 70 %
            </Text>
          </Group>
          <FactPlanBar fact={0.63} plan={0.7} color="var(--status-warning)" label="Образец" />
        </div>
        <SimpleGrid cols={3} spacing="xs">
          <Metric value="4" label="школ" />
          <Metric value="3" label="критично" color="critical" />
          <Metric value="1 045" label="людей на объектах" />
        </SimpleGrid>
        <Group gap="md">
          {[1, 2, 3].map((i) => (
            <Group key={i} gap={6} wrap="nowrap">
              <Box w={28} h={10} style={{ background: `var(--series-${i})`, borderRadius: 2 }} />
              <Text size="xs">Серия {i}</Text>
            </Group>
          ))}
        </Group>
        <Table.ScrollContainer minWidth={300}>
          <Table highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Объект</Table.Th>
                <Table.Th ta="right">Факт</Table.Th>
                <Table.Th>Состояние</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              <Table.Tr>
                <Table.Td>ул. Строителей, 5</Table.Td>
                <Table.Td ta="right">81 %</Table.Td>
                <Table.Td>
                  <RiskBadge risk="ok" size="xs" />
                </Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td>Школа № 1234</Table.Td>
                <Table.Td ta="right">47 %</Table.Td>
                <Table.Td>
                  <RiskBadge risk="crit" size="xs" />
                </Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        <TextInput label="Поле ввода" placeholder="Подсказка в поле" />
      </Stack>
    </Card>
  );
}
