import {
  ActionIcon,
  AppShell,
  Avatar,
  Burger,
  Group,
  Menu,
  NavLink,
  ScrollArea,
  Text,
  Tooltip,
  UnstyledButton,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { IconAdjustments, IconChartBar, IconHelp, IconLogout, IconMoon, IconSun, IconUsers } from '@tabler/icons-react';
import { GLOBAL_ROLE_LABELS } from '@mvs/shared';
import { api, directionsQuery, meQuery } from '../api';
import { DirectionIcon } from '../ui/DirectionIcon';
import { TasksBell } from './MyTasks';
import { Brand } from '../ui/Brand';

export function AppLayout() {
  const [opened, { toggle, close }] = useDisclosure();
  const { data: me } = useQuery(meQuery);
  const { data: directions = [] } = useQuery(directionsQuery);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme('light');

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    qc.clear();
    navigate({ to: '/login', search: { next: undefined } });
  }

  return (
    <AppShell header={{ height: 68 }} navbar={{ width: 244, breakpoint: 'sm', collapsed: { mobile: !opened } }} padding={{ base: 12, sm: 20, xl: 24 }}>
      <a className="skip-link" href="#main-content">Перейти к содержимому</a>
      <AppShell.Header>
        <Group className="header-content" h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Меню" />
            <Brand />
          </Group>
          <Group className="header-actions" gap="xs" wrap="nowrap">
            <TasksBell />
            <Tooltip label={scheme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}>
              <ActionIcon
                variant="default"
                size="lg"
                onClick={() => setColorScheme(scheme === 'dark' ? 'light' : 'dark')}
                aria-label="Сменить тему"
              >
                {scheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
              </ActionIcon>
            </Tooltip>
            <Menu position="bottom-end" width={240}>
              <Menu.Target>
                <UnstyledButton aria-label="Профиль">
                  <Group gap={8} wrap="nowrap">
                    <Avatar size={32} radius="xl" color="blue">
                      {initials(me?.fullName)}
                    </Avatar>
                    <div style={{ lineHeight: 1.1 }} className="mantine-visible-from-sm">
                      <Text size="sm" fw={500} visibleFrom="sm">
                        {me?.fullName}
                      </Text>
                      <Text size="xs" c="dimmed" visibleFrom="sm">
                        {me ? GLOBAL_ROLE_LABELS[me.globalRole] : ''}
                      </Text>
                    </div>
                  </Group>
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>{me?.login}</Menu.Label>
                <Menu.Item component={Link} to="/change-password">
                  Сменить пароль
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item color="red" leftSection={<IconLogout size={16} />} onClick={logout}>
                  Выйти
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        <AppShell.Section grow component={ScrollArea}>
          <NavLink
            component={Link}
            to="/"
            label="Производственная сводка"
            leftSection={<IconChartBar size={18} />}
            active={path === '/'}
            onClick={close}
          />
          <Text size="xs" c="dimmed" tt="uppercase" fw={600} px="sm" mt="md" mb={4}>
            Направления
          </Text>
          {directions.map((d) => (
            <NavLink
              key={d.code}
              renderRoot={(props) => <Link to="/d/$code" params={{ code: d.code }} {...props} />}
              label={d.shortName}
              description={`${d.sitesCount} ${d.siteUnit}`}
              leftSection={<DirectionIcon icon={d.icon} color={d.color} />}
              active={path.startsWith(`/d/${d.code}`)}
              onClick={close}
            />
          ))}
          {me?.globalRole === 'ADMIN' && (
            <>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600} px="sm" mt="md" mb={4}>
                Администрирование
              </Text>
              <NavLink
                component={Link}
                to="/admin/users"
                label="Пользователи и роли"
                leftSection={<IconUsers size={18} />}
                active={path.startsWith('/admin/users')}
                onClick={close}
              />
              <NavLink
                component={Link}
                to="/admin/directions"
                label="Конструктор направлений"
                leftSection={<IconAdjustments size={18} />}
                active={path.startsWith('/admin/directions')}
                onClick={close}
              />
            </>
          )}
        </AppShell.Section>
        <AppShell.Section>
          <NavLink component={Link} to="/help" label="Справка" leftSection={<IconHelp size={18} />} active={path === '/help'} onClick={close} />
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main id="main-content" tabIndex={-1}>
        <div className="workspace"><Outlet /></div>
      </AppShell.Main>
    </AppShell>
  );
}

function initials(name?: string) {
  if (!name) return '';
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}
