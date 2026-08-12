/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  // Semantic color tokens (primary/accent/success/warning/danger/neutral) are
  // defined natively via the `@theme` block in src/index.css, not here -
  // Tailwind v4 no longer auto-detects this JS config's theme.extend without
  // an explicit @config directive, and @theme is what gives us CSS custom
  // properties that ThemeContext can override at runtime for brand colors
  // and dark mode.
  theme: {
    extend: {},
  },
  plugins: [],
}