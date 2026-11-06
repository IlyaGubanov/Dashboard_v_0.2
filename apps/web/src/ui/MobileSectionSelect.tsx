import { Select } from '@mantine/core';

/** Мобильное представление тех же разрешённых вкладок. Состоянием и URL управляет исходная страница. */
export function MobileSectionSelect({ label, value, data, onChange }: {
  label: string; value: string; data: { value: string; label: string }[]; onChange: (value: string) => void;
}) {
  return <Select hiddenFrom="sm" label={label} value={value} data={data} allowDeselect={false}
    onChange={v => { if (v) onChange(v); }} comboboxProps={{ zIndex: 1000 }} />;
}
