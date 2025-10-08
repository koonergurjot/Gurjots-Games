# Design system refresh (Tailwind CSS + shadcn/ui)

This guide captures the UI decisions behind the current Tailwind/shadcn setup and how to extend it responsibly. Use it as the companion to `tailwind.config.js` and the generated component files in `src/components` when iterating on the shared primitives.

## Foundations

- **Color tokens**
  - Start from the extended palette in `tailwind.config.js` and expose surface/foreground aliases through CSS custom properties on `:root`. Keep contrast ratios ≥ 4.5:1 for body text.
  - When adding a new semantic color, define the light & dark values side by side so both themes ship in the same commit.
- **Typography**
  - Buttons, tabs, and toasts use the `font-sans` scale; modals and cards can opt into `font-heading` for section titles.
  - Always clamp line lengths with `max-w-prose` on text-heavy cards/modals to avoid overly wide paragraphs.
- **Motion**
  - Use Tailwind's `transition-*` utilities for hover/focus animation. For component enter/exit (modals, toasts, tabs), rely on shadcn/ui's built-in `@radix-ui/react-*` primitives and compose `data-[state=open]:animate-in` helpers.

## Component patterns

### Buttons

- Apply the `buttonVariants` helper from `components/ui/button.tsx` so variant logic stays centralized.
- Default spacing: `h-10 px-4 py-2`, roundness `rounded-lg`.
- Provide `primary`, `secondary`, and `ghost` variants. Prefer `destructive` over ad-hoc red buttons.
- Disabled state must combine `aria-disabled="true"` with `pointer-events-none opacity-50`.

### Cards

- Wrap card containers in `components/ui/card.tsx` to inherit consistent padding (`p-6`) and border styles.
- Reserve `shadow-sm` for grid listings; escalate to `shadow-md` only for focus/hover or featured content. Use `ring-2 ring-offset-2` to indicate selection instead of stronger drop shadows.
- For card headers, compose `CardHeader`, `CardTitle`, and `CardDescription` to preserve semantic spacing.

### Modals (Dialogs)

- Base modal markup on shadcn's `Dialog` component.
- For accessibility, keep the dialog width constrained (`sm:max-w-lg`) and set `aria-describedby` on the trigger when body copy exists.
- Animate overlay with `data-[state=open]:animate-in fade-in` and panel with `data-[state=open]:animate-in zoom-in-95`. Always pair with `data-[state=closed]:animate-out zoom-out-95`.
- Use Tailwind's `focus-visible:outline-none` on the dialog content and rely on `ring-1` for keyboard focus.

### Toasts

- Register the `Toaster` provider at the app root and fire toasts via `useToast()` hook from `components/ui/use-toast.ts`.
- Each toast should respect `variant` tokens (`default`, `success`, `destructive`). Map them to semantic Tailwind classes (`bg-muted`, `bg-green-600/90`, etc.).
- Limit toast body text to two lines with `line-clamp-2` and include an optional CTA button using the ghost button variant.
- To prevent stacking overflow, set `duration` defaults (4s) and allow manual dismissal via a close icon button.

### Tabs

- Use shadcn's `Tabs`, `TabsList`, `TabsTrigger`, and `TabsContent` primitives.
- Align triggers with `justify-start gap-2` and `border-b` container wrappers.
- To signal active tabs, rely on the data-state attribute: `data-[state=active]:text-foreground data-[state=active]:border-b-2 data-[state=active]:border-primary`.
- Tabs must be keyboard navigable via the arrow keys (handled by Radix) and should set `aria-controls`/`aria-labelledby` pairs automatically by forwarding `value` props.

## Implementation checklist

1. Import new primitives via `npx shadcn-ui@latest add <component>` rather than hand-rolling markup.
2. After adjusting tokens or variants, run `npm run lint && npm run test` to catch regressions.
3. Document bespoke variants or sizing changes in this file so feature teams know how to reuse them.
