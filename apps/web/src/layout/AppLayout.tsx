import {
  ActionIcon,
  Alert,
  AppShell,
  Avatar,
  Burger,
  Button,
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
import { IconAdjustments, IconBuildingFactory2, IconMap, IconChartBar, IconCurrencyRubel, IconEyeOff, IconHelp, IconLogout, IconMoon, IconPalette, IconSun, IconUsers } from '@tabler/icons-react';
import { GLOBAL_ROLE_LABELS } from '@mvs/shared';
import { api, directionsQuery, meQuery } from '../api';
import { DirectionIcon } from '../ui/DirectionIcon';
import { TasksBell } from './MyTasks';
import { Brand } from '../ui/Brand';
import { useAppearance } from '../ui/appearance';
import { canHideFinance, setFinanceHidden, useFinanceToggle } from '../ui/finance';
import { canSee } from '../ui/access';
import { IconVideo } from '@tabler/icons-react';

export function AppLayout() {
  const [opened, { toggle, close }] = useDisclosure();
  const { data: me } = useQuery(meQuery);
  // подпись под направлением в меню — «Оформление» → «Меню направлений»
  const { appearance, draft, setDraft } = useAppearance();
  const navCaption = appearance.nav.caption;
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
          <Group className="header-brand" gap="sm" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Меню" />
            <Brand />
          </Group>
          <Group className="header-actions" gap="xs" wrap="nowrap">
            {canHideFinance(me) && <FinanceToggle />}
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
          {canSee(me, 'overview') && (
            <NavLink
              component={Link}
              to="/"
              label="Производственная сводка"
              leftSection={<IconChartBar size={18} />}
              active={path === '/'}
              onClick={close}
            />
          )}
          {canSee(me, 'contractors') && (
            <NavLink
              component={Link}
              to="/contractors"
              label="Подрядчики"
              leftSection={<IconBuildingFactory2 size={18} />}
              active={path.startsWith('/contractors')}
              onClick={close}
            />
          )}
          {canSee(me, 'map') && <NavLink component={Link} to="/map" label="Карта" leftSection={<IconMap size={18} />} active={path === '/map'} onClick={close} />}
          <Text size="xs" c="dimmed" tt="uppercase" fw={600} px="sm" mt="md" mb={4}>
            Направления
          </Text>
          {directions.map((d) => (
            <NavLink
              key={d.code}
              renderRoot={(props) => <Link to="/d/$code" params={{ code: d.code }} {...props} />}
              label={d.shortName}
              description={navCaption === 'count' ? `${d.sitesCount} ${d.siteUnit}` : navCaption === 'name' ? d.name : undefined}
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
              <NavLink
                component={Link}
                to="/admin/appearance"
                label="Оформление"
                leftSection={<IconPalette size={18} />}
                active={path.startsWith('/admin/appearance')}
                onClick={close}
              />
            </>
          )}
          {me?.videoAccess?.manage && <NavLink component={Link} to="/admin/video" label="Настройки видеонаблюдения" leftSection={<IconVideo size={18} />} active={path === '/admin/video'} onClick={close} />}
        </AppShell.Section>
        <AppShell.Section>
          <NavLink component={Link} to="/help" label="Справка" leftSection={<IconHelp size={18} />} active={path === '/help'} onClick={close} />
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main id="main-content" tabIndex={-1}>
        {draft && path !== '/admin/appearance' && (
          <Alert color="orange" variant="light" mb="md" title="Оформление не сохранено — так его видите только вы">
            <Group gap="xs">
              <Button size="xs" component={Link} to="/admin/appearance">
                Вернуться к настройке
              </Button>
              <Button size="xs" variant="default" onClick={() => setDraft(null)}>
                Отменить изменения
              </Button>
            </Group>
          </Alert>
        )}
        <div className="workspace"><Outlet /></div>
      </AppShell.Main>
    </AppShell>
  );
}

/** Одна кнопка: скрыть или показать финансы во всех направлениях. */
function FinanceToggle() {
  const hidden = useFinanceToggle();
  const label = hidden ? 'Финансы скрыты — показать' : 'Скрыть финансовые данные во всех направлениях';
  const icon = hidden ? <IconEyeOff size={18} /> : <IconCurrencyRubel size={18} />;
  const props = {
    variant: hidden ? 'filled' : 'default',
    color: hidden ? 'orange' : undefined,
    onClick: () => setFinanceHidden(!hidden),
    'aria-pressed': hidden,
  } as const;
  return (
    <Tooltip label={label}>
      <div>
        <Button {...props} size="sm" leftSection={icon} visibleFrom="md">
          {hidden ? 'Финансы скрыты' : 'Финансы'}
        </Button>
        <ActionIcon {...props} size="lg" hiddenFrom="md" aria-label={label}>
          {icon}
        </ActionIcon>
      </div>
    </Tooltip>
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
