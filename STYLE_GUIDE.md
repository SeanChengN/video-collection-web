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

## Theme Migration Checklist

- SVG icons should use `fill="currentColor"` unless the icon asset itself requires multiple fixed colors.
- Buttons, tags, inputs, selects, notifications, tables, cards, and modal shells should consume `--vc-*` tokens.
- New hover, active, selected, disabled, and focus states should have both light and dark token values.
- Prefer changing legacy selector values to tokens over adding broader override selectors.
- Modal titles and window controls should use `--vc-modal-*` tokens.
- Dropdowns, pagination, list rows, result cards, and service cards should use `--vc-dropdown-*`, `--vc-list-*`, `--vc-result-*`, and `--vc-service-*` tokens.
- Button effects should use semantic action tokens such as `--vc-action-*` or feature tokens such as `--vc-duplicate-start-*`; do not reuse unrelated button colors just because the visual effect is similar.
- Gradient action button backgrounds are fixed across light/dark themes; themes may change only their text/icon contrast token.
- Gradient action buttons use `--vc-color-on-action` at rest and `--vc-color-on-action-hover` for hover/active; dark theme keeps the gradient fixed while switching rest text/icons to black and hover/active text/icons to white.
- Special action buttons that also carry Bulma state classes must use a more specific selector such as `.button.search-btn` or `.button.dupStart-btn`, otherwise `.button.is-info` / `.button.is-primary` can override the gradient.
- Maintenance create-backup is an action gradient button; do not style it with maintenance panel-only colors.
- Search filter tags and add/edit movie tags are the same tag-button component; style them together with `--vc-filter-tag-*` tokens.
- Search result tables and settings modal tables are the same list/table component; style their row, hover, border, and text states with shared `--vc-table-*` / `--vc-list-*` tokens.
- Filter tags and thumbnail tool controls should use their scoped tokens (`--vc-filter-tag-*`, `--vc-thumbnail-*`) instead of generic button/tag tokens when default, selected, and hover states need to differ.
- Avoid naked `#fff`, `#000`, `white`, `black`, `rgb(...)`, or `rgba(...)` in theme-critical component selectors; wrap them behind a token unless the color is part of media content or a deliberate overlay.
