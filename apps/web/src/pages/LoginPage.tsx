import { useState } from 'react';
import { Alert, Button, Center, Paper, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { loginSchema, type LoginInput } from '@mvs/shared';
import { api, ApiError } from '../api';
import { zodValidate } from '../ui/zodValidate';
import { Brand } from '../ui/Brand';

export function LoginPage() {
  const navigate = useNavigate();
  const { next } = useSearch({ from: '/login' });
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<LoginInput>({ initialValues: { login: '', password: '' }, validate: zodValidate(loginSchema) });

  async function submit(values: LoginInput) {
    setError(null);
    try {
      await api('/auth/login', { method: 'POST', body: values });
      await qc.invalidateQueries({ queryKey: ['me'] });
      // переход только внутри приложения
      const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
      navigate({ to: target });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Сервер недоступен');
    }
  }

  return (
    <Center mih="100vh" p="md" bg="var(--surface-muted)">
      <Paper className="auth-panel" withBorder shadow="sm" p="xl" w="100%" maw={420}>
        <form onSubmit={form.onSubmit(submit)}>
          <Stack>
            <Brand />
            <Title order={2} ta="center" fz="lg">Вход в систему</Title>
            {error && (
              <Alert color="red" variant="light">
                {error}
              </Alert>
            )}
            <TextInput label="Логин" autoComplete="username" autoFocus {...form.getInputProps('login')} />
            <PasswordInput label="Пароль" autoComplete="current-password" {...form.getInputProps('password')} />
            <Button type="submit" loading={form.submitting} fullWidth>
              Войти
            </Button>
            <Text size="xs" c="dimmed">
              Нет доступа или забыли пароль — обратитесь к администратору.
            </Text>
          </Stack>
        </form>
      </Paper>
    </Center>
  );
}
