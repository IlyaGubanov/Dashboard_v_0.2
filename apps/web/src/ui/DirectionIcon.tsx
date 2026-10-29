import { ThemeIcon } from '@mantine/core';
import { IconBuildingCommunity, IconFolder, IconPipeline, IconRoad, IconSchool } from '@tabler/icons-react';

/** Иконки направлений по коду из настроек направления (direction.icon). */
const ICONS = {
  school: IconSchool,
  building: IconBuildingCommunity,
  pipe: IconPipeline,
  road: IconRoad,
} as const;

export function DirectionIcon({ icon, color, size = 28 }: { icon: string | null; color: string | null; size?: number }) {
  const Icon = (icon && ICONS[icon as keyof typeof ICONS]) || IconFolder;
  return (
    <ThemeIcon size={size} radius="md" variant="light" color={color ?? 'gray'}>
      <Icon size={size * 0.6} />
    </ThemeIcon>
  );
}
