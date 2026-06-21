module.exports = {
  extends: ['./node_modules/@hcengineering/platform-rig/profiles/default/eslint.config.json'],
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: './tsconfig.json'
  },
  rules: {
    // Wave-8 Task D3 — gate new `as any` casts. Existing branded-type /
    // event-handler / behavior-coupled casts are documented with
    // `eslint-disable-next-line` + reason comments.
    '@typescript-eslint/no-explicit-any': 'error'
  }
}
