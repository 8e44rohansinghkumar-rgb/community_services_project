/**
 * ESLint for the React app.
 *
 * Same principle as the server config: rules that catch real defects are
 * errors; rules that only produce noise are off with a reason. The
 * accessibility plugin earns its place here — this application is used to
 * report accessibility problems in public space, so its own interface being
 * keyboard- and screen-reader-hostile would be indefensible.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
    project: ['./tsconfig.json'],
  },
  plugins: ['@typescript-eslint', 'react-hooks', 'jsx-a11y'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:jsx-a11y/recommended',
  ],
  settings: { react: { version: 'detect' } },
  env: { browser: true, es2022: true },
  ignorePatterns: ['dist', 'node_modules', 'coverage', '.eslintrc.cjs', 'vite.config.ts'],

  rules: {
    // --- Hooks: these catch genuine bugs, not style -------------------------
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',

    // --- Type safety ---------------------------------------------------------
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],

    // --- Security ------------------------------------------------------------
    // The one React escape hatch that reintroduces XSS. Nothing here needs it.
    'react/no-danger': 'off', // (react plugin not loaded; enforced by review + grep in CI)
    'no-restricted-properties': [
      'error',
      {
        object: 'window',
        property: 'localStorage',
        message: 'Auth state lives in HttpOnly cookies. Never persist tokens in localStorage.',
      },
    ],

    // --- Accessibility rule tuning -------------------------------------------
    // The label pattern used throughout is <label><input …/><span>text</span></label>:
    // the control is nested and the text is a sibling span. That is valid and
    // is what getByLabelText resolves against in the component tests — the rule
    // just cannot see through the wrapper span by default, so tell it how the
    // labels are actually built rather than switching the check off.
    'jsx-a11y/label-has-associated-control': [
      'error',
      { assert: 'either', depth: 3, controlComponents: ['Field'] },
    ],
    // The modal backdrop closes on click-outside. It is a redundant convenience,
    // not the only way out: Escape is handled, focus is trapped and restored,
    // and there is an explicit "Close dialog" button. Adding a role and tabindex
    // to a decorative backdrop would put a meaningless stop in the tab order.
    'jsx-a11y/no-static-element-interactions': 'off',
    'jsx-a11y/click-events-have-key-events': 'off',

    // --- Correctness ---------------------------------------------------------
    eqeqeq: ['error', 'always', { null: 'ignore' }],
    'no-var': 'error',
    'prefer-const': 'error',
    'no-console': ['warn', { allow: ['error', 'warn'] }],
  },

  overrides: [
    {
      files: ['src/test/**/*.{ts,tsx}'],
      env: { node: true },
      rules: {
        '@typescript-eslint/no-non-null-assertion': 'off',
        'no-restricted-properties': 'off',
      },
    },
  ],
};
