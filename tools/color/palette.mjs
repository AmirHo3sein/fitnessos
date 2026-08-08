/**
 * The FitnessOS palette definition.
 *
 * Every colour in the product derives from this file. Nothing else picks a colour.
 *
 * ## Why one lightness ramp for every family
 *
 * `LIGHTNESS` below is shared by brand, neutral and all four status families. That is what
 * makes `teal-600` and `red-600` carry the same visual weight, which is in turn what lets a
 * semantic token swap families without the UI changing density — a destructive button and a
 * primary button are the same button in a different hue, and they should look it.
 *
 * The ramp is NOT linear. It is dense at the light end because that is where surfaces live
 * and a UI needs several distinguishable near-whites, and it opens up in the middle where
 * one step should read as a clear state change (hover, pressed).
 *
 * ## Why chroma is a curve, not a constant
 *
 * A colour near white or near black cannot hold much chroma — sRGB has no room for it, and
 * OKLCH will happily describe one that does not exist. `CHROMA_CURVE` tapers at both ends and
 * peaks around 500–600 where the brand actually needs saturation. Every step is then run
 * through `fitGamut`, which reduces chroma rather than clamping RGB: clamping shifts hue, so a
 * too-saturated teal clips blue and drifts green, silently, in exactly the steps a brand cares
 * about most.
 */
import { fitGamut, oklchToHex } from './oklch.mjs'

export const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]

/**
 * Perceptual lightness per step, shared by every family.
 *
 * The two load-bearing values:
 *   600 (0.556) — the primary interactive surface. Chosen as the lightest step that still
 *                 clears 4.5:1 against white, so buttons are as vivid as accessibility allows
 *                 rather than as dark as caution would suggest.
 *   500 (0.648) — the brand's expressive step. Clears 3:1, so it is legal for large text and
 *                 UI boundaries but NOT for body text. The contrast report enforces that.
 */
export const LIGHTNESS = {
  50: 0.985,
  100: 0.962,
  200: 0.921,
  300: 0.861,
  400: 0.759,
  500: 0.648,
  600: 0.545,
  700: 0.474,
  800: 0.404,
  900: 0.344,
  950: 0.244,
}

/** Chroma as a fraction of each family's peak. Tapers where sRGB cannot hold saturation. */
const CHROMA_CURVE = {
  50: 0.1,
  100: 0.22,
  200: 0.42,
  300: 0.66,
  400: 0.88,
  500: 1.0,
  600: 0.98,
  700: 0.88,
  800: 0.76,
  900: 0.64,
  950: 0.46,
}

/**
 * The families.
 *
 * Hue choices, and what each is avoiding:
 *
 * `teal` 194 — the brand. Deep blue-green. Deliberately not 180 (pure cyan, which reads as
 *   gaming/crypto at high chroma) and not 210 (which drifts toward generic SaaS blue). Peak
 *   chroma 0.108 is restrained on purpose: a vivid teal sits around 0.15 and reads as a
 *   consumer fitness app rather than infrastructure.
 *
 * `slate` 233 — cool neutral, harmonising with the teal without echoing it. A pure grey
 *   (chroma 0) beside a saturated teal looks dirty, because the eye reads the neutral as
 *   faintly orange by simultaneous contrast. Chroma peaks at 0.028 — enough to be cool,
 *   little enough that nobody would call it blue. The dark end is lifted separately below so
 *   that surfaces read navy-teal rather than grey.
 *
 * `green` 152 — success. Pushed away from the brand's 194 so a success badge is never mistaken
 *   for a brand element. 165 would have been a prettier green and sat 29° from teal; 152 sits
 *   42° away and is the safer call.
 *
 * `amber` 74 — warning. Wide sRGB gamut, so it carries chroma well.
 *
 * `red` 27 — destructive. Slightly orange-leaning rather than pure 0°, which keeps it from
 *   vibrating against the teal (complementary hues at high chroma shimmer at their boundary).
 *
 * `blue` 258 — informational. Far enough from teal (64°) to be unambiguous, which matters
 *   because info and brand are the two that would otherwise be confused.
 */
export const FAMILIES = {
  teal: { hue: 194, peak: 0.108 },
  slate: { hue: 233, peak: 0.028 },
  green: { hue: 152, peak: 0.132 },
  amber: { hue: 74, peak: 0.145 },
  red: { hue: 27, peak: 0.168 },
  blue: { hue: 258, peak: 0.142 },
}

/**
 * Extra chroma at the dark end of the neutral scale.
 *
 * The reference direction calls for deep navy-teal surfaces, not grey ones. At the shared
 * curve's chroma the 900/950 steps read as charcoal; these multipliers push them into navy
 * without touching the light end, where the same shift would make cards look tinted and
 * cheap.
 */
const SLATE_DARK_BOOST = { 700: 1.3, 800: 1.7, 900: 2.1, 950: 2.4 }

const buildScale = (name, { hue, peak }) => {
  const scale = {}
  for (const step of STEPS) {
    const boost = name === 'slate' ? (SLATE_DARK_BOOST[step] ?? 1) : 1
    const wanted = peak * CHROMA_CURVE[step] * boost
    const L = LIGHTNESS[step]
    const C = fitGamut(L, wanted, hue)
    scale[step] = { hex: oklchToHex(L, C, hue), L, C: Math.round(C * 10000) / 10000, H: hue }
  }
  return scale
}

export const PALETTE = Object.fromEntries(
  Object.entries(FAMILIES).map(([name, spec]) => [name, buildScale(name, spec)]),
)

/**
 * The categorical chart palette.
 *
 * Three constraints, and they conflict, so the resolution is explicit:
 *
 * 1. **Distinguishable when several series share a chart.** Twelve categorical colours always
 *    crowd the hue wheel, so hues are ordered for maximum *adjacent* separation — series 1
 *    and 2 are the pair most often compared, and they sit 135° apart. Sequential neighbours,
 *    not the set as a whole, are what a reader actually discriminates.
 *
 * 2. **Not reliant on hue alone.** Lightness alternates by ±0.055 between neighbours, so
 *    adjacent series differ in value as well as hue. That survives greyscale printing and the
 *    common forms of colour vision deficiency, where hue collapses and value does not.
 *
 * 3. **Not competing with the brand.** Every hue avoids a 30° exclusion zone around teal's
 *    194. A chart series in brand teal reads as interactive, and in a dashboard full of
 *    clickable elements that is a real misdirection rather than a cosmetic one.
 *
 * Light and dark get different lightness, same hues. A single palette tuned to sit between
 * both backgrounds is legible against neither — this is the one place where "works on both"
 * has to mean two sets, not one compromise.
 */
/*
 * OKLCH hue angles are NOT HSL hue angles, and the first draft of this list was written with
 * HSL intuitions. OKLCH 228 is azure, not blue — it rendered as a cyan that sat 34° from the
 * brand and read as interactive in a chart. Roughly: 15 red · 34 orange · 78 amber · 122 leaf ·
 * 150 green · 194 teal (brand) · 240 indigo · 262 blue · 284 purple · 306 violet · 328 magenta ·
 * 350 rose.
 *
 * Every hue below sits at least 30° from the brand's 194, and the order maximises separation
 * between ADJACENT indices, since series 1 and 2 are the pair a reader actually compares.
 */
const CHART_HUES = [262, 34, 150, 306, 78, 240, 350, 122, 284, 56, 328, 12]

const chartScale = (baseL, alt, chroma) =>
  CHART_HUES.map((hue, index) => {
    const L = baseL + (index % 2 === 0 ? 0 : alt)
    const C = fitGamut(L, chroma, hue)
    return oklchToHex(L, C, hue)
  })

export const CHART = {
  // Darker on white so a thin 1px line is still legible.
  light: chartScale(0.58, 0.055, 0.135),
  // Lighter on navy. Chroma is pulled back slightly: saturated colour on a dark ground blooms,
  // and a chart of twelve blooming series is unreadable.
  dark: chartScale(0.735, -0.055, 0.115),
}

export const hex = (family, step) => PALETTE[family][step].hex
