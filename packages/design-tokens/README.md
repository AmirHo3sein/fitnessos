# FitnessOS Colour System v1.0

Deep teal identity, cool slate neutrals, navy-teal dark surfaces. Restrained on purpose:
calm, technical, trustworthy — premium enterprise infrastructure that happens to be about
training, not a fitness app.

**Every colour in the product derives from `tools/color/`.** Nothing else picks one.

```bash
pnpm tokens:build      # regenerate tokens.css + generated.ts
pnpm tokens:check      # fail if the committed tokens are stale
pnpm color:contrast    # fail if any documented pair drops below its WCAG threshold
pnpm color:lint        # fail if a component names a primitive or a hex literal
```

All four run in CI. **120/120 contrast checks pass**, computed rather than asserted — see
[I. Accessibility](#i-accessibility-report).

---

## Architecture

```
component  →  semantic token  →  primitive  →  theme
```

| Level | Example | Who may reference it |
|---|---|---|
| **1 · Primitive** | `--color-teal-600` | The semantic layer only |
| **2 · Semantic** | `--action-primary`, `bg-surface` | **Components. This is the only level they may touch.** |
| **3 · Component** | `--input`, `--ring` (shadcn aliases) | Only where a third-party contract forces a fixed name |

**Where the boundary is drawn.** Level 3 exists for exactly one reason: shadcn/ui components
are copied into the repo and reference fixed variable names. Aliasing them once is cheaper
than editing every component after every `shadcn add`. Nothing else earns a component token —
a `button.primary.bg` that is only ever `--action-primary` is a synonym, and synonyms are how a
token system doubles in size without gaining a capability.

**Changing the brand later** means editing `FAMILIES.teal.hue` in `tools/color/palette.mjs` and
rebuilding. No component changes, because no component names teal. The contrast report will
tell you immediately whether the new hue still clears its thresholds.

---

## A. Final palette

Generated in OKLCH so scales stay perceptually parallel across hues — that is what makes
`teal-600` and `red-600` carry the same visual weight, which is what lets a semantic token swap
families without the UI changing density.

### Brand — Teal (hue 194)

| Step | Hex | On white | Intended use |
|---|---|---|---|
| 50 | `#f2fdfc` | 1.04 | Tinted page washes, selected-row backgrounds |
| 100 | `#e1f8f7` | 1.11 | Selection fill, subtle brand surfaces |
| 200 | `#c3efee` | 1.24 | Brand-tinted borders, pressed light states |
| 300 | `#99e1df` | 1.48 | Dark-theme hover for the primary action |
| 400 | `#5ec4c2` | 2.07 | **Dark theme's primary action and brand text** |
| 500 | `#13a3a2` | 3.09 | Expressive accent, large text ≥24px, chart target line |
| 600 | `#008180` | **4.72** | **Light theme's primary action, focus ring, brand border** |
| 700 | `#006a69` | 6.43 | Primary hover; brand text on light |
| 800 | `#005454` | 8.76 | Primary pressed; dark-theme selection fill |
| 900 | `#004242` | 11.30 | Strong brand text, deep surfaces |
| 950 | `#002626` | 16.09 | Deepest brand surface |

> `500` is the *expressive* step and `600` is the *working* one. 500 clears 3:1, so it is legal
> for large text and UI boundaries and **illegal for body text**.

### Neutral — Slate (hue 233, cool)

| Step | Hex | Use |
|---|---|---|
| 50 | `#f8fafc` | Light canvas · dark primary text |
| 100 | `#eff3f6` | Hover surface · sunken panels |
| 200 | `#dee6ec` | Subtle borders · disabled action fill |
| 300 | `#c6d4dc` | Default borders · dark secondary text |
| 400 | `#a2b4be` | Disabled text (light) · muted text (dark) · chart axis |
| 500 | `#7e929d` | **Strong borders — the interactive boundary, both themes** |
| 600 | `#61737e` | Muted text (light) · disabled text (dark) |
| 700 | `#4a5f6b` | Secondary text (light) · borders (dark) |
| 800 | `#354c59` | Elevated surface (dark) · subtle borders (dark) |
| 900 | `#243c49` | Primary text (light) · **surface (dark)** |
| 950 | `#10232d` | **Canvas (dark)** — deep navy-teal, not black |

A pure grey beside a saturated teal reads as faintly orange by simultaneous contrast. Chroma
peaks at 0.028 — cool enough to sit well, low enough that nobody would call it blue. The dark
steps get an extra chroma boost so surfaces read navy-teal rather than charcoal.

### Status

| Family | Hue | 600 (light solid) | 400 (dark solid) | On white |
|---|---|---|---|---|
| Success — green | 152 | `#218548` | `#75c68c` | 4.65 |
| Warning — amber | 74 | `#976400` | `#e1a44a` | 5.07 |
| Error — red | 27 | `#bd3e37` | `#ff8a7e` | 5.37 |
| Info — blue | 258 | `#386fc0` | `#7eb2ff` | 5.00 |

Green sits 42° from the brand so a success badge is never mistaken for a brand element. Red
leans slightly orange rather than sitting at pure 0°, which stops it vibrating against the teal
— complementary hues at high chroma shimmer at their boundary. Info sits 64° from teal, because
info and brand are the two that would otherwise be confused.

---

## B. Semantic tokens

58 semantic + 22 chart + 22 editor + 6 domain. Full values in `src/tokens.css`.

| Group | Tokens |
|---|---|
| Surfaces | `bg-canvas` `bg-surface` `bg-surface-subtle` `bg-surface-elevated` `bg-surface-hover` `bg-surface-active` `bg-surface-sunken` `bg-inverse` |
| Text | `text-primary` `text-secondary` `text-muted` `text-disabled` `text-inverse` `text-brand` `text-on-brand` |
| Borders | `border-subtle` `border-default` `border-strong` `border-brand` |
| Actions | `action-primary` `-hover` `-active` `-fg` · `action-secondary…` · `action-ghost…` · `action-destructive…` · `action-disabled` `-fg` |
| Status | `status-{success,warning,error,info}-{surface,border,fg,solid}` |
| Feedback | `focus` `focus-offset` `selection-bg` `selection-fg` `overlay` `scrim` |

**Why status has four roles each.** A badge needs a tinted background and dark text; an alert
needs a border too; a chart dot needs a solid on the page background. One "success colour"
cannot serve all three, and the version that tries ends up as the one that fails contrast in
whichever context nobody checked.

---

## C / D. Light and dark

Dark is **designed, not inverted**. Three things an inversion cannot capture:

- **Elevation.** On light, a raised surface is lighter than the canvas and casts a shadow. On
  dark, shadows do almost nothing, so elevation is *also* lighter — inverting would make raised
  surfaces darker, which reads as a hole rather than a card.
- **Saturation blooms on dark grounds.** The same chroma that reads restrained on white reads
  neon on navy. Dark uses lower-chroma steps for the same role.
- **Primary action flips polarity.** Light: dark teal, white text. Dark: light teal
  (`teal-400`), dark text (`slate-950`) — a dark-teal button on a navy canvas has nowhere to go.

| Role | Light | Dark |
|---|---|---|
| canvas | `slate-50` | `slate-950` |
| surface | `#ffffff` | `slate-900` |
| elevated | `#ffffff` + shadow | `slate-800` |
| text-primary | `slate-900` (11.55) | `slate-50` (11.04) |
| action-primary | `teal-600` / white (4.72) | `teal-400` / `slate-950` (7.81) |
| focus | `teal-600` (4.72) | `teal-400` (7.81) |

Canvas is `slate-50` and cards are **white**, not the other way round. That is what makes cards
read as objects rather than page regions — and it is why a card needs no border, which is where
the uncluttered quality actually comes from.

Dark canvas is `#10232d`, not black: pure black makes every surface above it a visible grey
rectangle and smears on OLED during scroll. Dark text is `slate-50`, not `#fff`: at full white
on near-black, halation makes small text appear to vibrate.

---

## E. Tailwind

`packages/ui/src/theme.css` binds tokens to utilities via `@theme inline`. Use:

```tsx
<div className="bg-surface text-primary border-default">
<button className="bg-action text-action-fg hover:bg-action-hover">
<p className="text-muted">
<span className="text-error-fg">
```

Never `bg-teal-600`, never `style={{ color: '#008180' }}`. `pnpm color:lint` fails the build on
either — probe-verified.

## F. shadcn/ui mapping

```
--background → bg-canvas          --primary            → action-primary
--foreground → text-primary       --primary-foreground → action-primary-fg
--card       → bg-surface         --secondary…         → action-secondary…
--popover    → bg-surface-elevated --muted             → bg-surface-subtle
--border     → border-default     --muted-foreground   → text-muted
--input      → border-STRONG      --accent             → bg-surface-hover
--ring       → focus              --destructive…       → action-destructive…
```

Two deliberate departures from shadcn's defaults:

- **`--input` → `border-strong`, not `border-default`.** shadcn uses `--input` for a field's
  outline, which is an interactive boundary needing 3:1 (WCAG 1.4.11). `border-default` measures
  1.5:1. Using it would ship inaccessible inputs on every shadcn form in the product.
- **`--background` → canvas, `--card` → surface.** shadcn conflates them; we do not, for the
  reason above.

Plus additions shadcn lacks: `--success` `--warning` `--info` (+ foregrounds),
`--surface-elevated`, `--surface-hover`, `--overlay`.

## G. Chart palette

12 categorical series, **separate values per theme** — a single palette tuned to sit between
white and navy is legible against neither.

```ts
import { chartSeries, chartColors, modalityColor } from '@fitnessos/design-tokens'
const series = chartSeries('dark')        // 12 colours in order
chartColors.light['chart-positive']
```

Charts are the one place a JavaScript colour value is genuinely needed — a canvas renderer or an
SVG attribute needs a string, and `getComputedStyle` on every render is slow and returns nothing
during SSR. **Everything else uses CSS variables.**

Three constraints, resolved explicitly:

1. **Adjacent separation.** Hues ordered so consecutive indices sit ~130° apart. Series 1 and 2
   are the pair a reader actually compares; the set as a whole is not.
2. **Not hue alone.** Lightness alternates ±0.055 between neighbours, so adjacent series differ
   in value too — which survives greyscale and the common colour vision deficiencies, where hue
   collapses and value does not.
3. **Never the brand.** Every hue sits ≥30° from teal's 194. A series in brand teal reads as
   interactive, and in a dashboard full of clickable things that is real misdirection.

Semantic annotations: `chart-positive` `chart-negative` `chart-neutral` `chart-baseline`
`chart-target` `chart-reference` `chart-forecast` `chart-missing` `chart-grid` `chart-axis`.

`chart-target` **uses the brand** — the one deliberate exception. A target line is not a series;
it is the goal the series is measured against, which is the most brand-aligned concept on the
chart. `chart-forecast` is the same hue at 50% alpha, because a forecast *is* a projected target
and a different hue would imply a different quantity. `chart-missing` must be paired with a
hatch pattern: colour alone cannot say "unknown", and a pale block reads as a low value.

## H. Editor palette

22 tokens per theme, for the six builders. An editor is mostly *content*, so every affordance
competes with the thing being edited — each of these is a low-alpha fill or a 1–2px line, never
a saturated block.

`editor-selection` (12–16% brand fill) · `-selection-border` · `-selection-multi` ·
`-hover-outline` · `-node-active` · `-drag-preview` · `-drop-zone` · `-drop-zone-border` ·
`-insertion` · `-snap-guide` · `-align-guide` · `-resize-handle` · `-connection` ·
`-connection-valid` · `-connection-invalid` · `-locked` · `-readonly-surface` · `-unsaved` ·
`-error` · `-warning` · `-grid`

Alphas rather than solids, because a selection fill sits over arbitrary content — a chart, an
image, a dark panel — and a solid tint would erase it.

**`editor-snap-guide` is magenta, not teal.** It is the one editor affordance allowed to be
loud, because it is transient and must be instantly distinguishable from a selection. Everything
else defers to the content.

## I. Accessibility report

**120/120 checks pass.** Run `pnpm color:contrast` for the full table. Thresholds: 4.5:1 normal
text (1.4.3), 3:1 large text and UI boundaries (1.4.11).

| Pair | Light | Dark |
|---|---|---|
| text-primary on surface | 11.55 | 11.04 |
| text-secondary on surface | 6.69 | 7.62 |
| text-muted on surface | 4.93 | 5.40 |
| text-brand on surface | 6.43 | 5.58 |
| primary button label | 4.72 | 7.81 |
| destructive button label | 5.37 | 5.37 |
| focus ring vs canvas | 4.51 | 7.81 |
| border-strong vs surface | 3.24 | 3.57 |
| success text on its surface | 8.27 | 8.71 |
| error text on its surface | 9.19 | 8.94 |

Two failures were found and **fixed by changing the colour, not the threshold**:

- `green-600` measured **4.47** against white at the original lightness. The shared ramp's 600
  step was darkened to 0.545 so every family clears 4.5 — the eye is most sensitive to green, so
  it carries more luminance than its OKLab L suggests. Tuning to the brand alone would have
  shipped a failing success button.
- `border-strong` measured **2.14** (light) and **2.34** (dark). It is the interactive boundary,
  so it needs 3:1; moved from `slate-400`/`slate-600` to `slate-500` in both themes.

### Must NOT be used for text

| Token | Measured | Why it is still here |
|---|---|---|
| `text-disabled` | 2.14 light · 2.99 dark | WCAG 1.4.3 exempts inactive controls. Kept legible enough to read *what* is disabled — a disabled field you cannot read is a dead end rather than a locked door. Never use for active text. |
| any `-500` step | teal-500 = 3.09 | Legal for large text (≥24px) and UI boundaries. **Illegal for body text.** |
| `chart-missing` | intentionally low | Must recede, and must be paired with a pattern. |

## J. Usage rules

**Primary (teal).** One primary action per view. It marks *the* next step, not every clickable
thing. Also: focus rings, active nav, selected states, the chart target line. A page with three
teal buttons has no primary action.

**How much teal on a page.** Roughly 5–10% of coloured area. The identity comes from restraint —
a teal header, a teal button and teal links on the same screen is a fitness app, not
infrastructure. **Not every page needs the primary colour**; a settings page with one teal
"Save" is correct.

**Accent.** There is deliberately no separate accent colour. A second decorative hue is the
fastest way to a page that looks assembled rather than designed. Emphasis comes from weight,
size and surface, and the brand is the only chromatic emphasis available.

**Status colours** are for *state*, never decoration. A green badge means something succeeded,
not that something is good. Never use red for emphasis.

**Neutrals** carry the interface. Text, borders, surfaces, structure — everything that is not a
state or an action.

**Chart colours** appear only in data visualisation, and never on interactive chrome.

**Gradients:** permitted on marketing surfaces, empty-state illustrations, and skeleton shimmer.
**Not permitted** on buttons, cards, inputs, table rows, or anything with a state — a gradient
has no hover, and every attempt to give it one produces a control that shifts weight when
touched.

**Dark surfaces vs cards.** Canvas `slate-950`, card `slate-900`, elevated `slate-800`. Elevation
goes *up* in lightness. Never separate two dark surfaces with a border alone; the lightness step
is the signal, and the border is at most a refinement.

**Disabled.** Reduce contrast, never opacity. `opacity: 0.5` on a button also fades its shadow
and any icon inside it, and compounds when nested. Use `action-disabled` + `action-disabled-fg`.

**Destructive.** Red fill only for the confirming action inside a confirmation — never for the
button that *opens* one. A red "Delete" in a toolbar trains people to ignore red.

## K. Naming conventions

`{category}-{role}-{variant}` — `bg-surface-elevated`, `action-primary-hover`,
`status-error-fg`.

- Categories: `bg` `text` `border` `action` `status` `chart` `editor` plus bare `focus`,
  `selection-*`, `overlay`, `scrim`.
- `-fg` means "the foreground that goes ON this thing". `text-*` is standalone text.
- States are suffixes on the base token, never separate tokens: `-hover` `-active` `-disabled`.
- Primitives are `--color-{family}-{step}`. The `--color-` prefix marks Level 1 — if you type it
  in a component, you have skipped a level.

## L. File structure

```
tools/color/
  oklch.mjs            colour maths — OKLCH→sRGB, WCAG contrast. Build-time only.
  palette.mjs          LEVEL 1. Hues, lightness ramp, chroma curves, chart hues.
  semantic.mjs         LEVEL 2. Light, dark, editor, chart, domain tokens.
  emit.mjs             generates the package below
  contrast-report.mjs  CI gate — WCAG, 120 checks
  check-tokens.mjs     CI gate — generated files are current
  lint-usage.mjs       CI gate — no primitives or literals in components

packages/design-tokens/
  src/tokens.css       GENERATED — CSS variables + shadcn aliases
  src/generated.ts     GENERATED — TS values for charts
  src/index.ts         public surface

packages/ui/src/theme.css   Tailwind @theme bindings. Contains no colour values.
```

`tools/` rather than inside the package because the generator is build tooling, and shipping it
inside `packages/design-tokens` would put colour-space maths in the dependency graph of
everything that imports a token.

## Domain colours — and why there are so few

The test applied: **does this concept have an inherent direction that colour would communicate
truthfully?** Only two pass.

**`readiness-{high,moderate,low}`** — passes. Low readiness genuinely means "do less today", and
that is exactly the kind of instruction colour conveys well.

**`trend-{up,down,flat}`** — passes as *direction*, not quality. A regression during a planned
deload is intended; colouring it "bad" would tell the athlete their programme is failing when it
is working.

Everything else gets a **stable chart slot** instead — a convention so a modality keeps its
colour across the product, without pretending the colour means anything:

- `strength` `endurance` `mobility` `recovery` are **modalities**: categorical, no valence.
  Making strength red implies danger; making it green implies it is better than mobility.
  Neither is a claim the product should make.
- `load` and `fatigue` are **magnitudes without valence**, and this is the important one. High
  load is the *point* of training. Colouring it red teaches an athlete that training hard is
  dangerous — false, and directly counter to what the product is for. Fatigue is the expected
  consequence of work, not a fault.

```ts
import { modalityColor } from '@fitnessos/design-tokens'
modalityColor('strength', 'dark')   // chart-1 for that theme
```
