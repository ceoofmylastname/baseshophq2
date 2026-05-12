import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-config-prettier";
import globals from "globals";

// Correctness-only config. Stylistic concerns belong to prettier.
// Rules tuned to NOT flag working code in src/; they catch genuine bugs
// (hook deps, unused imports, hook misuse) without enforcing taste.
export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "supabase/functions/**",
      "scripts/**",
      "tests/**",
      "*.config.js",
      "*.config.ts",
    ],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.es2024 },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-undef": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  prettier,
];
