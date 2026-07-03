# Video Collection Style Guide

## Direction

- Keep Bulma as the base CSS framework.
- Add app-owned design tokens and `vc-*` component classes for new UI.
- Do not introduce Tailwind, daisyUI, Sass, or PostCSS unless the project explicitly chooses a larger migration.

## Source Layout

- Design tokens live in `src/styles/system/00-tokens.css`.
- Theme overrides live in `src/styles/system/10-themes.css`.
- Bulma compatibility and scoped legacy bridging lives in `src/styles/system/20-bulma-bridge.css`.
- New reusable app components live in `src/styles/system/30-components.css`.
- Small app utilities live in `src/styles/system/40-utilities.css`.
- Generated CSS files are `static/non-critical.css` and `static/styles.min.css`; do not edit them directly.

## Tokens

- Use semantic names: `--vc-color-*`, `--vc-space-*`, `--vc-radius-*`, `--vc-shadow-*`.
- Prefer tokens over hard-coded colors, spacing, borders, shadows, and z-index.
- New feature CSS should consume tokens first, then add local component variables only when needed.

## Components

- Prefer `vc-*` classes for app-specific reusable patterns.
- Use Bulma classes for basic layout and form primitives when they already fit.
- Avoid long descendant selectors unless scoping legacy behavior.
- Avoid styling by incidental text, generated IDs, or nested structure that is likely to change.

## Themes

- Theme selection is CSS-driven with `html[data-theme="light"]` or `html[data-theme="dark"]`.
- The browser storage key is `vc-theme`; valid values are `light` and `dark`.
- The theme toggle lives in the settings modal and does not call the backend.
- Themes override tokens; components consume tokens.
- Keep light theme behavior compatible with the existing UI.
- Add theme-specific fixes in the bridge layer only when legacy Bulma/custom styles need scoped support.
- When migrating legacy CSS, keep the existing selector if it is part of the current UI contract, but move hard-coded colors, borders, shadows, and control colors to `--vc-*` tokens.

## AI Editing Rules

- For new styles, first look for an existing token or `vc-*` component.
- If a hard-coded value appears more than once, promote it to a token.
- Keep CSS changes close to the smallest relevant source file.
- Preserve UTF-8 for Chinese labels and comments.
