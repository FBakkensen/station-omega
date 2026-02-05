import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['node_modules/', '**/*.js'],
  },
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
