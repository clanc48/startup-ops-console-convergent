import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default [
 {
 ignores: [
 "**/*.{js,cjs,mjs}",
 ".next/**",
 "node_modules/**",
 "dist/**",
 "**/AppData/Local/Temp/**",
 "**/Temp/**",
 ],
 },
 js.configs.recommended,
 ...tseslint.configs.recommended,
 {
 files: ["**/*.{ts,tsx}"],
 plugins: {
 "react-hooks": reactHooks,
 },
 rules: {
 // Focus on dead-code-style hygiene without requiring a full refactor.
 "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
 "no-unused-vars": "off",

 // Too noisy for this repo right now; keep it off.
 "@typescript-eslint/no-explicit-any": "off",

 // Use hooks dependency checks for React components.
 ...reactHooks.configs.recommended.rules,
 },
 },
];
