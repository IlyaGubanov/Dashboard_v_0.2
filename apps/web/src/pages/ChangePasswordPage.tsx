import { Alert, Button, Center, Paper, PasswordInput, Stack, Text, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { changePasswordSchema, type ChangePasswordInput } from '@mvs/shared';
import { api, ApiError, meQuery } from '../api';
import { zodValidate } from '../ui/zodValidate';
import { Brand } from '../ui/Brand';

type Values = ChangePasswordInput & { repeat: string };

export function ChangePasswordPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useQuery(meQuery);
  const form = useForm<Values>({
    initialValues: { currentPassword: '', newPassword: '', repeat: '' },
    validate: (v) => ({
      ...zodValidate<Values>(changePasswordSchema)(v),
      ...(v.repeat !== v.newPassword ? { repeat: 'Пароли не совпадают' } : {}),
    }),
  });

  async function submit({ currentPassword, newPassword }: Values) {
    try {
      await api('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });
      await qc.invalidateQueries({ queryKey: ['me'] });
      notifications.show({ color: 'green', message: 'Пароль изменён' });
      navigate({ to: '/' });
    } catch (e) {
      if (e instanceof ApiError) {
        form.setErrors(e.fields);
        if (!Object.keys(e.fields).length) form.setFieldError('currentPassword', e.message);
      }
    }
  }

  return (
    <Center mih="100vh" p="md" bg="var(--surface-muted)">
      <Paper className="auth-panel" withBorder shadow="sm" p="xl" w="100%" maw={420}>
        <form onSubmit={form.onSubmit(submit)}>
          <Stack>
            <Brand />
            <Title order={3}>Смена пароля</Title>
            {me?.mustChangePassword && (
              <Alert variant="light" color="blue">
                Пароль выдан администратором. Задайте свой, чтобы продолжить.
              </Alert>
            )}
            <PasswordInput label="Текущий пароль" autoComplete="current-password" {...form.getInputProps('currentPassword')} />
            <PasswordInput label="Новый пароль" autoComplete="new-password" {...form.getInputProps('newPassword')} />
            <PasswordInput label="Повторите новый пароль" autoComplete="new-password" {...form.getInputProps('repeat')} />
            <Text size="xs" c="dimmed">
              Не короче 10 символов, буквы и цифры.
            </Text>
            <Button type="submit" loading={form.submitting}>
              Сохранить
            </Button>
          </Stack>
        </form>
      </Paper>
    </Center>
  );
}
