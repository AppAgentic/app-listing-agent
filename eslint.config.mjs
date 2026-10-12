import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTypeScript from 'eslint-config-next/typescript'

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  // Brownfield baseline: keep these existing violations visible in `lint:all`
  // while allowing CI to fail on every other error and on newly enabled rules.
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      '@next/next/no-html-link-for-pages': 'warn',
      'prefer-const': 'warn',
      'react/no-unescaped-entities': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/static-components': 'warn',
    },
  },
  globalIgnores([
    '.next/**',
    'coverage/**',
    'functions/lib/**',
    'node_modules/**',
  ]),
])
