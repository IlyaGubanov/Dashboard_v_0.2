import { defineConfig } from 'vitest/config';

// Интеграционные наборы читают общую карту направлений и удаляют свои фикстуры.
// Последовательный запуск файлов исключает исчезновение чужой фикстуры между двумя запросами.
const integration = process.env.MAP_TEST_DATABASE_URL || process.env.REPORT_TEST_DATABASE_URL || process.env.PANORAMA_TEST_DATABASE_URL || process.env.DELAY_TEST_DATABASE_URL;
export default defineConfig({ test: { fileParallelism: !integration } });
