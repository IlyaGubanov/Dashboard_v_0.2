import { Group, type GroupProps } from '@mantine/core';

/** Панель остаётся в потоке формы и доступна в её области прокрутки. Обработчики и disabled задаёт форма. */
export function FormActions({ className, ...props }: GroupProps) {
  return <Group {...props} className={['form-actions', className].filter(Boolean).join(' ')} />;
}
