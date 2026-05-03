/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/contracts/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^jose$': '<rootDir>/src/lib/__mocks__/jose.ts',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { module: 'CommonJS' } }],
  },
};
