// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Engine purity: pure TS, no framework, no DOM, no app-layer imports.
    files: ['src/engine/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'engine is framework-free' },
            { name: 'react-dom', message: 'engine is framework-free' },
            { name: 'zustand', message: 'engine is framework-free' },
            { name: 'dexie', message: 'engine has no persistence' },
            { name: 'immer', message: 'engine uses plain data' },
            { name: 'nanoid', message: 'engine IDs must be seed-derived (rng.ts)' },
          ],
          patterns: [
            {
              group: [
                '**/app/**',
                '**/features/**',
                '**/state/**',
                '**/db/**',
                '**/worker/**',
                '**/lib/**',
              ],
              message: 'engine must not import app layers',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'engine runs anywhere (worker/node)' },
        { name: 'document', message: 'engine runs anywhere (worker/node)' },
        { name: 'localStorage', message: 'engine has no storage' },
        { name: 'navigator', message: 'engine runs anywhere (worker/node)' },
      ],
    },
  },
);
