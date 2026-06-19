import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Design-handoff mockup — not shipped app source, not in the build.
    // Linting it surfaced ~76 errors for a static reference file.
    "design_handoff_pure_eq/**",
  ]),
  {
    // Underscore-prefixed args/vars are intentionally unused (e.g. a param
    // kept for signature shape on a mock that a real impl will consume).
    // Standard convention so they don't need one-off disable comments.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
]);

export default eslintConfig;
