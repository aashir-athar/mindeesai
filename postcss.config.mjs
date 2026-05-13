/**
 * PostCSS config — Tailwind v4 entrypoint.
 *
 * Without this file, the `@import "tailwindcss"` directive in `app/globals.css`
 * resolves but yields zero generated utility classes. The `@tailwindcss/postcss`
 * plugin is what actually scans your source for class names and emits CSS.
 */
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
