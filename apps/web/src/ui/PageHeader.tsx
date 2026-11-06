import type { ReactNode } from 'react';
import { Group, Text, Title } from '@mantine/core';

/** Общая иерархия заголовка: текст переносится, действия остаются доступны при крупном шрифте. */
export function PageHeader({ title, description, icon, actions, metadata }: {
  title: string; description?: ReactNode; icon?: ReactNode; actions?: ReactNode; metadata?: ReactNode;
}) {
  return <Group className="page-header" justify="space-between" align="flex-start">
    <Group gap="sm" wrap="nowrap" align="flex-start" className="page-header-heading">
      {icon && <span className="page-header-icon" aria-hidden="true">{icon}</span>}
      <div className="page-header-copy">
        <Title order={2}>{title}</Title>
        {description && <Text component="div" size="sm" c="dimmed" mt={4}>{description}</Text>}
        {metadata}
      </div>
    </Group>
    {actions && <Group gap="xs" className="page-header-actions">{actions}</Group>}
  </Group>;
}
