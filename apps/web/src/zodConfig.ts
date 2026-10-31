import { z } from 'zod';

// Действующая CSP запрещает eval. Настройка предшествует созданию схем, чтобы отключить и пробу new Function.
z.config({ jitless: true });
