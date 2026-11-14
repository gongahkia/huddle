import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tests/database/*.spec.ts'],environment:'node',fileParallelism:false,testTimeout:30000,hookTimeout:30000}});
