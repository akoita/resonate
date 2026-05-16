import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(repoRoot, 'web');

export default {
  root: webRoot,
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: [
      'tests/**/*',
      'node_modules/**/*',
      '../backend/dist/**/*',
      '../contracts/lib/**/*',
      '../contracts/out/**/*',
      '../contracts/cache/**/*',
    ],
  },
  resolve: {
    alias: {
      '@': path.join(webRoot, 'src'),
    },
  },
};
