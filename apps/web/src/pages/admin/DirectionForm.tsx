import { ColorInput, NumberInput, Select, SimpleGrid, Switch, Text, TextInput, Textarea } from '@mantine/core';
import {
  ICONS,
  MONEY_SOURCE_LABELS,
  MONEY_SOURCES,
  PERIOD_KIND_LABELS,
  PERIOD_KINDS,
  PLAN_METHOD_LABELS,
  PLAN_METHODS,
  PROGRESS_METHOD_LABELS,
  PROGRESS_METHODS,
  type DirectionInput,
} from '@mvs/shared';

export const emptyDirection: DirectionInput = {
  code: '',
  name: '',
  shortName: '',
  icon: 'folder',
  color: '#2f6fd6',
  periodKind: 'WEEK',
  planWeekday: 3,
  progressMethod: 'WEIGHTED_BY_COST',
  planMethod: 'LINEAR_ITEM_DATES',
  moneySource: 'WORK_ITEMS',
  moneyLabel: 'Договор',
  thrWarn: -5,
  thrCrit: -15,
  siteUnit: 'объектов',
  factLabel: '',
};

const ICON_LABELS: Record<(typeof ICONS)[number], string> = { school: 'Школа', building: 'Дом', pipe: 'Трубы', road: 'Дорога', folder: 'Папка' };
const WEEKDAYS = ['понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу', 'воскресенье'];

/** Основные настройки направления: название, период, формула готовности, план, деньги, пороги. */
export function DirectionForm({ v, setV, errors, isNew }: { v: DirectionInput; setV: (v: DirectionInput) => void; errors: Record<string, string>; isNew?: boolean }) {
  const set = (p: Partial<DirectionInput>) => setV({ ...v, ...p });
  return (
    <>
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <TextInput label="Полное название" required error={errors.name} value={v.name} onChange={(e) => set({ name: e.currentTarget.value })} />
        <TextInput label="Краткое (в меню и сводке)" required error={errors.shortName} value={v.shortName} onChange={(e) => set({ shortName: e.currentTarget.value })} />
        <TextInput
          label="Код"
          description="латиницей, в адресе страницы; после создания не меняется"
          required
          disabled={!isNew}
          error={errors.code}
          value={v.code}
          onChange={(e) => set({ code: e.currentTarget.value })}
        />
        <TextInput label="Как называть объекты" description="«адресов», «школ», «парков»" value={v.siteUnit ?? ''} onChange={(e) => set({ siteUnit: e.currentTarget.value })} />
        <Select label="Значок" allowDeselect={false} data={ICONS.map((i) => ({ value: i, label: ICON_LABELS[i] }))} value={v.icon ?? 'folder'} onChange={(x) => set({ icon: x as DirectionInput['icon'] })} />
        <ColorInput label="Цвет" error={errors.color} value={v.color ?? ''} onChange={(x) => set({ color: x })} />
      </SimpleGrid>
      <Textarea label="Описание" autosize minRows={2} value={v.description ?? ''} onChange={(e) => set({ description: e.currentTarget.value })} />

      <Text fw={600} mt="sm">
        Как считается готовность
      </Text>
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Select label="Отчётные точки" allowDeselect={false} data={PERIOD_KINDS.map((k) => ({ value: k, label: PERIOD_KIND_LABELS[k] }))} value={v.periodKind} onChange={(x) => set({ periodKind: x as DirectionInput['periodKind'] })} />
        {v.periodKind === 'WEEK' && (
          <Select
            label="План недели считается на"
            allowDeselect={false}
            data={WEEKDAYS.map((d, i) => ({ value: String(i + 1), label: d }))}
            value={String(v.planWeekday ?? 3)}
            onChange={(x) => set({ planWeekday: Number(x) })}
          />
        )}
        <Select
          label="Формула готовности"
          allowDeselect={false}
          data={PROGRESS_METHODS.map((k) => ({ value: k, label: PROGRESS_METHOD_LABELS[k] }))}
          value={v.progressMethod}
          onChange={(x) => set({ progressMethod: x as DirectionInput['progressMethod'] })}
        />
        <Select label="План" allowDeselect={false} data={PLAN_METHODS.map((k) => ({ value: k, label: PLAN_METHOD_LABELS[k] }))} value={v.planMethod} onChange={(x) => set({ planMethod: x as DirectionInput['planMethod'] })} />
        <Select label="Деньги" allowDeselect={false} data={MONEY_SOURCES.map((k) => ({ value: k, label: MONEY_SOURCE_LABELS[k] }))} value={v.moneySource ?? 'NONE'} onChange={(x) => set({ moneySource: x as DirectionInput['moneySource'] })} />
        {v.moneySource !== 'NONE' && <TextInput label="Подпись стоимости" description="«Договор», «Лимит»" value={v.moneyLabel ?? ''} onChange={(e) => set({ moneyLabel: e.currentTarget.value })} />}
        <TextInput label="Подпись готовности в сводке" description="пусто — по формуле" value={v.factLabel ?? ''} onChange={(e) => set({ factLabel: e.currentTarget.value })} />
      </SimpleGrid>

      <Text fw={600} mt="sm">
        Пороги для объектов (отклонение факт − план)
      </Text>
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <NumberInput label="Отставание, если хуже" suffix=" п.п." max={0} min={-100} error={errors.thrWarn} value={v.thrWarn} onChange={(x) => set({ thrWarn: Number(x) })} />
        <NumberInput label="Критично, если хуже" suffix=" п.п." max={0} min={-100} error={errors.thrCrit} value={v.thrCrit} onChange={(x) => set({ thrCrit: Number(x) })} />
      </SimpleGrid>
      <Switch mt="sm" label="Только просмотр — данные приходят отчётами, ручного ввода нет" checked={!!v.isReadonly} onChange={(e) => set({ isReadonly: e.currentTarget.checked })} />
      {!isNew && <Switch label="Направление включено (видно в меню и сводке)" checked={v.isActive !== false} onChange={(e) => set({ isActive: e.currentTarget.checked })} />}
    </>
  );
}
