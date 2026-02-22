import tseslint from 'typescript-eslint';

const NETWORK_BOUNDARY_ALLOWLIST = [
  'src/io/inworld-tts-client.ts',
  'test/setup/no-network.ts',
  'test/setup/no-network.test.ts',
  'test/setup/fixtures/import-time-fetch-side-effect.ts',
  'test/setup/fixtures/import-time-http-side-effect.ts',
  'web/src/services/tts-client.ts',
  'web/src/test/setup.ts',
  'web/src/test/no-network.test.ts',
];

export default tseslint.config(
  {
    ignores: ['node_modules/', 'convex/_generated/**', '**/*.js'],
  },
  ...tseslint.configs.strictTypeChecked,
  {
    files: ['**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'node:http', message: 'Use the deterministic no-network harness, not direct HTTP imports.' },
          { name: 'node:https', message: 'Use the deterministic no-network harness, not direct HTTPS imports.' },
          { name: 'node:net', message: 'Use the deterministic no-network harness, not direct socket imports.' },
          { name: 'node:tls', message: 'Use the deterministic no-network harness, not direct TLS imports.' },
        ],
      }],
      'no-restricted-globals': ['error', {
        name: 'fetch',
        message: 'Use an explicit IO client boundary instead of direct fetch calls.',
      }],
    },
  },
  {
    files: NETWORK_BOUNDARY_ALLOWLIST,
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-globals': 'off',
    },
  },
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      'no-unreachable': 'error',
    },
  },
);
