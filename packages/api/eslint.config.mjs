import globals from "globals";
import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      "no-unused-vars": ["warn", { 
        "argsIgnorePattern": "^_",
        "varsIgnorePattern": "^_",
      }],
      "no-console": "off",
      "no-empty": "warn",
    },
    ignores: [
      "node_modules/**",
      "dist/**",
    ],
  },
  {
    files: ["**/*.test.js", "**/tests/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
  },
];
