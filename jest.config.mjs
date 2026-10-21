import nextJest from 'next/jest.js';

const createJestConfig = nextJest({ dir: './' });

// allowJs-style: the 156 original tests stay .js; newer tests may be .js or .ts.
export default createJestConfig({
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/jest.setup.ts'],
  testMatch: ['<rootDir>/__tests__/**/*.test.{js,ts}'],
  testPathIgnorePatterns: ['/node_modules/', '/.next/'],
  modulePathIgnorePatterns: ['<rootDir>/.next/'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
});
