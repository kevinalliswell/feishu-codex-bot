import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules", "desktop/dist", "desktop/.generated", "desktop/src-tauri/target"] },
  ...tseslint.configs.recommended,
  {
    files: ["desktop/src/**/*.{ts,tsx}", "desktop/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }]
    }
  }
);
