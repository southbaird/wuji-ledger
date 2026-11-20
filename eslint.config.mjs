import obsidianmd from 'eslint-plugin-obsidianmd';

export default [
  { ignores: ['node_modules/**', 'dist/**', 'main.js', '*.config.*', 'scripts/**'] },
  ...obsidianmd.configs.recommended,
  { languageOptions: { parserOptions: { projectService: true } } },
];
