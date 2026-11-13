import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tests/**/*.test.{ts,tsx}'],environment:'node',testTimeout:15000},resolve:{alias:{'@huddle/shared':new URL('./packages/shared/src/index.ts',import.meta.url).pathname}}});
