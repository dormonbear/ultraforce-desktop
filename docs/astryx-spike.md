# Astryx local spike

Branch: `spike/astryx-local`

## Scope

- Install `@astryxdesign/core`, `@astryxdesign/theme-neutral`, and `@astryxdesign/cli`.
- Import Astryx component CSS and neutral theme CSS without importing Astryx reset.
- Wrap the app in an Astryx `Theme` bridge that follows the existing app theme.
- Add a small Astryx-built panel to Settings using `Card`, `Text`, and `Button`.

## Initial Findings

- TypeScript accepts the Astryx packages with the current React 19 setup.
- Vite production build succeeds without adding StyleX build plugins.
- Astryx can coexist with the current Tailwind/shadcn/Radix stack when limited to leaf UI.
- The CSS payload increases noticeably because `@astryxdesign/core/astryx.css` brings the full component stylesheet.

## Verification

- `rtk tsc --noEmit`
- `pnpm build`
- `pnpm lint`

## Recommendation

Keep this as a local experiment for low-risk surfaces such as Settings, simple dialogs, empty states, and form sections. Do not migrate dense project-specific surfaces yet: result tables, Timeline, Trace Flags, Monaco panels, and log analysis views still need bespoke behavior.
