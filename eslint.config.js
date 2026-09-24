import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  // 基础规则（不依赖类型信息，适用于所有文件包括 .js）
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // 类型检查规则（仅适用于 .ts/.tsx 文件，.js 无类型信息）
  ...tseslint.configs.recommendedTypeChecked.map((c) => ({ ...c, files: ['**/*.{ts,tsx}'] })),
  ...tseslint.configs.stylistic.map((c) => ({ ...c, files: ['**/*.{ts,tsx}'] })),
  prettier,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: {
          tsconfigRootDir: import.meta.dirname,
          allowDefaultProject: ['vite.config.ts'],
        },
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    rules: {
      // 任务书 §4：禁用 any 逃逸。显式 any 一律报错。
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'all' },
      ],
    },
  },
  {
    files: ['**/*.{test,spec}.{ts,tsx}', 'vitest.setup.ts'],
    languageOptions: {
      globals: { ...globals.jest, ...globals.browser },
    },
    rules: {
      // vitest.setup.ts 里的事件监听器 polyfill 是故意的空函数
      '@typescript-eslint/no-empty-function': 'off',
    },
  },
  {
    ignores: ['dist/', 'node_modules/', 'build/'],
  },
);
