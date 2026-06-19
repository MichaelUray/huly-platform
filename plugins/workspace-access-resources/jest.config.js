module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)'],
  setupFiles: ['<rootDir>/src/__mocks__/jestSetup.ts'],
  moduleNameMapper: {
    '^svelte/store$': '<rootDir>/src/__mocks__/svelte-store-shim.ts'
  }
}
