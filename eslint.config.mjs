import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Data fetching in useEffect and hydration guards (setMounted) are
      // legitimate React patterns used throughout the codebase.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: ["**/__tests__/**", "**/*.test.*", "**/*.spec.*"],
    rules: {
      // Jest mocking requires require() for dynamic module loading after jest.mock()
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "contracts/**",
  ]),
]);

export default eslintConfig;
