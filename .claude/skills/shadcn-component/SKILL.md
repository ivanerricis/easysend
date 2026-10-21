---
name: shadcn-component
description: Add or use a shadcn/ui component in the EasySend web app (style radix-lyra) without breaking the strict CSP, accessibility (WCAG 2.2 AA, 44 px targets) or tests. Use when building UI or replacing a native control.
---

# shadcn/ui component (EasySend)

Rule from CLAUDE.md: wherever shadcn/ui has a component, use it instead of a native control;
keep a native element only when shadcn has no equivalent or it is clearly more accessible.
Also load the `ui-ux-pro-max` skill for design decisions.

## Adding a component

1. Check `apps/web/src/components/ui/` first. Config: `apps/web/components.json` (style
   `radix-lyra`, base `zinc`, square corners, lucide icons, aliases `@/components/ui`).
2. Add it with the shadcn CLI from `apps/web` (version pinned in the pnpm catalog), or by hand from
   the radix-lyra source using the installed `radix-ui` package
   (`import { Slider as SliderPrimitive } from 'radix-ui'`). No new npm dependency without asking
   the user.
3. Shared wrappers live in `components/common/` (e.g. `SelectInput`, `HintTooltip`, `FormField`).
   Wire form controls through `FormField` `controlProps` (id, `aria-describedby`, `aria-invalid`).

## CSP (style-src without 'unsafe-inline')

Radix and some libraries inject `<style>` elements, which the CSP blocks. Inline `style`
attributes are allowed (`style-src-attr`). After adding a component:

1. `pnpm --filter @easysend/web build`, then open the page in the local stack or run
   `pnpm screenshots` / `pnpm test:e2e`: a CSP violation fails the E2E fixture.
2. If a dependency injects CSS, follow the existing pattern in `apps/web/vite.config.ts`
   (`withoutStyleInjection` / `withoutInlineCss`, the build fails if the patched text disappears)
   and move the CSS rules to `apps/web/src/index.css`.

## Accessibility checklist

- Controls at least 44x44 px (hit area can be larger than the visual); visible focus ring.
- Accessible names: labels via `htmlFor`/`aria-labelledby`; a Radix listbox or popup gets its own
  name (see `SelectInput`, which copies the trigger's label to the listbox).
- Status not by colour only; live regions for async status; respect `prefers-reduced-motion`.
- Tooltips only for supplementary info, triggers focusable.
- Light and dark themes: use the CSS tokens, never literal colours.

## Tests

- Unit tests with Testing Library; for Radix Select use `src/test/select.ts` (`chooseOption`).
- Keep existing `data-testid`s and accessible names stable: the Playwright suite relies on them.
- `pnpm lint`, `pnpm typecheck`, `pnpm --filter @easysend/web test`; i18n keys in both `it` and `en`.
