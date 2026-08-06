import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "claude-plugin/vendor/**", "tmp/**", ".npm-cache/**"] },
  {
    files: ["**/*.{js,mjs,ts}"],
    languageOptions: {
      globals: { ...globals.node, ...globals.nodeBuiltin }
    }
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }]
    }
  }
);
