import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'coverage']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      'no-restricted-globals': ['error', {
        name: 'fetch',
        message: 'Use a service client boundary instead of direct fetch calls.',
      }],
    },
  },
  {
    files: ['src/services/tts-client.ts', 'src/test/setup.ts', 'src/test/no-network.test.ts'],
    rules: {
      'no-restricted-globals': 'off',
    },
  },
])
