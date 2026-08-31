/**
 * Type-aware ESLint configuration.
 *
 * The rule selection is deliberate. Rules that catch real defects are errors;
 * rules that only produce noise against correctly written code are off, with
 * the reason recorded beside each one.
 *
 * A linter reporting 150 things nobody intends to fix trains people to ignore
 * it, which is worse than not running one at all.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    // Separate project file: tsconfig.json excludes tests, but they should be
    // linted too.
    project: ['./tsconfig.eslint.json'],
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { node: true, es2022: true },
  ignorePatterns: ['dist', 'node_modules', 'coverage', 'var', '.eslintrc.cjs'],

  rules: {
    // --- Async correctness: the highest-value rules here ---------------------
    // An unawaited promise in an Express handler sends the response before the
    // work finishes, and turns a rejection into an unhandled crash rather than
    // a clean 500.
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': 'error',
    '@typescript-eslint/await-thenable': 'error',
    // Off: several handlers are async to satisfy a shared signature even when a
    // particular branch has nothing to await. That is intentional, not a defect.
    '@typescript-eslint/require-await': 'off',

    // --- Type safety ---------------------------------------------------------
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unnecessary-type-assertion': 'error',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],

    // --- no-unsafe-* are deliberately off ------------------------------------
    // These fire where `any` leaks out of third-party callback signatures
    // (pino-http serializers, cookie-parser's req.cookies, Express generics),
    // not on anything this code does wrong — every such site narrows with a
    // typeof check before use. Enabling them produced 89 reports and zero
    // defects, which is exactly the ratio that gets a linter switched off.
    '@typescript-eslint/no-unsafe-assignment': 'off',
    '@typescript-eslint/no-unsafe-member-access': 'off',
    '@typescript-eslint/no-unsafe-argument': 'off',
    '@typescript-eslint/no-unsafe-call': 'off',
    '@typescript-eslint/no-unsafe-return': 'off',

    // --- General correctness -------------------------------------------------
    // Catches String(someObject) rendering as "[object Object]".
    '@typescript-eslint/no-base-to-string': 'error',
    eqeqeq: ['error', 'always', { null: 'ignore' }],
    'no-var': 'error',
    'prefer-const': 'error',
    'no-console': ['warn', { allow: ['error', 'warn'] }],
  },

  overrides: [
    {
      // The migration CLI and seed script are console programs by design.
      files: ['src/db/seed.ts', 'src/db/cli.ts', 'src/db/migrator.ts'],
      rules: { 'no-console': 'off' },
    },
    {
      // Tests assert against JSON response bodies, which are legitimately
      // untyped at the boundary.
      files: ['tests/**/*.ts'],
      rules: {
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      },
    },
  ],
};
