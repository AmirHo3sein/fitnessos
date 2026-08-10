/**
 * Semantic tokens — Level 2 of the three-level architecture.
 *
 * Level 1 (primitives, `palette.mjs`) says *what a colour is*: `teal.600`.
 * Level 2 (here) says *what a colour is for*: `action.primary`.
 * Level 3 (component tokens) exists only where a component genuinely needs a value the
 * semantic layer cannot express — see the note at the bottom of this file.
 *
 * **Components may only ever reference Level 2.** That is the whole point: it is what lets the
 * brand hue change without touching a component, and what lets light and dark be two value
 * sets rather than two codebases.
 *
 * ## Light and dark are designed, not inverted
 *
 * Inverting a light theme produces a dark theme that is technically legible and feels wrong,
 * because the two behave differently in ways an inversion cannot capture:
 *
 * - **Elevation reverses.** On light, a raised surface is *lighter* than the canvas and casts a
 *   shadow. On dark, shadows are nearly invisible, so elevation is signalled by a *lighter*
 *   surface too — the direction is the same but the mechanism is different, and inverting would
 *   make raised surfaces darker, which reads as a hole rather than a card.
 * - **Saturation blooms on dark grounds.** The same chroma that reads as restrained on white
 *   reads as neon on navy. Dark theme uses lower-chroma steps for the same semantic role.
 * - **The primary action flips polarity.** On light it is a dark teal with white text; on dark a
 *   dark teal on a dark ground has nowhere to go, so it becomes a light teal with dark text.
 */
import { PALETTE, CHART } from './palette.mjs'

const p = (family, step) => PALETTE[family][step].hex
const WHITE = '#ffffff'

/**
 * Light theme.
 *
 * The canvas is `slate.50`, not white, and cards are white. That inversion of the naive
 * arrangement is what makes cards read as objects on a surface rather than as regions of the
 * page — and it means a card needs no border to be legible, which is where the "generous,
 * uncluttered" quality actually comes from.
 */
export const LIGHT = {
  // --- surfaces -------------------------------------------------------------
  'bg-canvas': p('slate', 50),
  'bg-surface': WHITE,
  'bg-surface-subtle': p('slate', 50),
  'bg-surface-elevated': WHITE,
  'bg-surface-hover': p('slate', 100),
  'bg-surface-active': p('slate', 200),
  'bg-surface-sunken': p('slate', 100),
  'bg-inverse': p('slate', 900),

  // --- text -----------------------------------------------------------------
  'text-primary': p('slate', 900),
  'text-secondary': p('slate', 700),
  'text-muted': p('slate', 600),
  // Below AA, and deliberately so — see the exemption note in the contrast report.
  'text-disabled': p('slate', 400),
  'text-inverse': p('slate', 50),
  'text-brand': p('teal', 700),
  'text-on-brand': WHITE,

  // --- borders --------------------------------------------------------------
  'border-subtle': p('slate', 200),
  'border-default': p('slate', 300),
  // 500, not 400. `border-strong` is the INTERACTIVE boundary — input outlines, the edge that
  // tells a user where a control begins — so WCAG 1.4.11 requires 3:1 against the surface.
  // slate-400 measured 2.14:1 and the report rejected it. `subtle` and `default` are decorative
  // dividers and carry no such requirement, which is precisely why they are separate tokens.
  'border-strong': p('slate', 500),
  'border-brand': p('teal', 600),

  // --- actions --------------------------------------------------------------
  'action-primary': p('teal', 600),
  'action-primary-hover': p('teal', 700),
  'action-primary-active': p('teal', 800),
  'action-primary-fg': WHITE,

  'action-secondary': WHITE,
  'action-secondary-hover': p('slate', 100),
  'action-secondary-active': p('slate', 200),
  'action-secondary-fg': p('slate', 900),

  'action-ghost-hover': p('slate', 100),
  'action-ghost-active': p('slate', 200),
  'action-ghost-fg': p('slate', 700),

  'action-destructive': p('red', 600),
  'action-destructive-hover': p('red', 700),
  'action-destructive-active': p('red', 800),
  'action-destructive-fg': WHITE,

  'action-disabled': p('slate', 200),
  'action-disabled-fg': p('slate', 400),

  // --- status ---------------------------------------------------------------
  // Each status has a surface (tinted background), a border, a foreground for text ON the
  // surface, and a solid for icons/dots on the canvas. Four roles, because a badge, an alert
  // and a chart dot need different things from the same semantic colour.
  'status-success-surface': p('green', 50),
  'status-success-border': p('green', 200),
  'status-success-fg': p('green', 800),
  'status-success-solid': p('green', 600),

  'status-warning-surface': p('amber', 50),
  'status-warning-border': p('amber', 200),
  'status-warning-fg': p('amber', 800),
  'status-warning-solid': p('amber', 600),

  'status-error-surface': p('red', 50),
  'status-error-border': p('red', 200),
  'status-error-fg': p('red', 800),
  'status-error-solid': p('red', 600),

  'status-info-surface': p('blue', 50),
  'status-info-border': p('blue', 200),
  'status-info-fg': p('blue', 800),
  'status-info-solid': p('blue', 600),

  // --- feedback -------------------------------------------------------------
  focus: p('teal', 600),
  'focus-offset': WHITE,
  'selection-bg': p('teal', 100),
  'selection-fg': p('teal', 900),
  overlay: p('slate', 900),
  scrim: p('slate', 950),
}

/**
 * Dark theme.
 *
 * Canvas is `slate.950` — a deep navy-teal, not black. Pure black is avoided because it makes
 * every surface above it a visible grey rectangle, and because on OLED it produces smearing on
 * scroll. Pure white text is avoided for the reciprocal reason: at full white on near-black the
 * halation makes small text appear to vibrate.
 */
export const DARK = {
  // --- surfaces -------------------------------------------------------------
  // Elevation goes UP in lightness, same as light theme's shadow direction implies, because
  // shadows do almost nothing on a dark ground.
  'bg-canvas': p('slate', 950),
  'bg-surface': p('slate', 900),
  'bg-surface-subtle': p('slate', 950),
  'bg-surface-elevated': p('slate', 800),
  'bg-surface-hover': p('slate', 800),
  'bg-surface-active': p('slate', 700),
  'bg-surface-sunken': p('slate', 950),
  'bg-inverse': p('slate', 100),

  // --- text -----------------------------------------------------------------
  // `slate.50`, not `#fff`. See the halation note above.
  'text-primary': p('slate', 50),
  'text-secondary': p('slate', 300),
  'text-muted': p('slate', 400),
  'text-disabled': p('slate', 600),
  'text-inverse': p('slate', 900),
  // 400, not 700: on a dark ground the brand has to come UP in lightness to be legible, and
  // this is where the reference's "soft teal accent" lives.
  'text-brand': p('teal', 400),
  'text-on-brand': p('slate', 950),

  // --- borders --------------------------------------------------------------
  // Borders on dark are lighter than the surface they sit on, and pulled in one step from the
  // light theme's equivalents: the same relative step is far more visible on a dark ground and
  // would draw a grid over the whole interface.
  'border-subtle': p('slate', 800),
  'border-default': p('slate', 700),
  // Same 3:1 requirement as light, and the same correction: slate-600 measured 2.34:1 on the
  // surface it has to sit on.
  'border-strong': p('slate', 500),
  'border-brand': p('teal', 500),

  // --- actions --------------------------------------------------------------
  // Polarity flips: a light teal carrying dark text. A dark-teal button on a navy canvas has
  // nowhere to go, and raising its lightness is the only way to keep it reading as the primary
  // action rather than as another panel.
  'action-primary': p('teal', 400),
  'action-primary-hover': p('teal', 300),
  'action-primary-active': p('teal', 200),
  'action-primary-fg': p('slate', 950),

  'action-secondary': p('slate', 800),
  'action-secondary-hover': p('slate', 700),
  'action-secondary-active': p('slate', 600),
  'action-secondary-fg': p('slate', 50),

  'action-ghost-hover': p('slate', 800),
  'action-ghost-active': p('slate', 700),
  'action-ghost-fg': p('slate', 300),

  // Red keeps white text rather than flipping, because a light-red button reads as pink and
  // loses the alarm the role depends on.
  'action-destructive': p('red', 600),
  'action-destructive-hover': p('red', 500),
  'action-destructive-active': p('red', 400),
  'action-destructive-fg': WHITE,

  'action-disabled': p('slate', 800),
  'action-disabled-fg': p('slate', 600),

  // --- status ---------------------------------------------------------------
  // Surfaces are the 950 step — a dark tint, not the light theme's pale wash inverted, which
  // would be a bright block on a dark page.
  'status-success-surface': p('green', 950),
  'status-success-border': p('green', 800),
  'status-success-fg': p('green', 300),
  'status-success-solid': p('green', 400),

  'status-warning-surface': p('amber', 950),
  'status-warning-border': p('amber', 800),
  'status-warning-fg': p('amber', 300),
  'status-warning-solid': p('amber', 400),

  'status-error-surface': p('red', 950),
  'status-error-border': p('red', 800),
  'status-error-fg': p('red', 300),
  'status-error-solid': p('red', 400),

  'status-info-surface': p('blue', 950),
  'status-info-border': p('blue', 800),
  'status-info-fg': p('blue', 300),
  'status-info-solid': p('blue', 400),

  // --- feedback -------------------------------------------------------------
  focus: p('teal', 400),
  'focus-offset': p('slate', 950),
  'selection-bg': p('teal', 800),
  'selection-fg': p('teal', 50),
  overlay: p('slate', 950),
  scrim: '#000000',
}

/**
 * Editor and builder tokens.
 *
 * Six builders share these, and the governing constraint is that an editor is mostly *content*.
 * Every affordance competes with the thing being edited, so each of these is either a
 * low-alpha fill or a 1–2px line, and none is a saturated block.
 *
 * Alpha values rather than solid colours, deliberately: a selection fill has to sit over
 * arbitrary content — a chart, an image, a dark panel — and a solid tint would erase it. The
 * alpha is baked into the CSS value so a component never composites by hand.
 */
export const EDITOR = {
  light: {
    'editor-selection': `${p('teal', 600)}1f`,
    'editor-selection-border': p('teal', 600),
    'editor-selection-multi': `${p('teal', 600)}14`,
    'editor-hover-outline': `${p('teal', 500)}80`,
    'editor-node-active': p('teal', 600),
    'editor-drag-preview': `${p('slate', 900)}26`,
    'editor-drop-zone': `${p('teal', 500)}1a`,
    'editor-drop-zone-border': p('teal', 500),
    'editor-insertion': p('teal', 600),
    // Magenta, not teal: a snap guide must be distinguishable from a selection at a glance, and
    // it is the one editor affordance that is allowed to be loud because it is transient.
    'editor-snap-guide': '#e5399b',
    'editor-align-guide': `${p('blue', 500)}b3`,
    'editor-resize-handle': p('teal', 600),
    'editor-resize-handle-fg': WHITE,
    'editor-connection': p('slate', 500),
    'editor-connection-valid': p('green', 600),
    'editor-connection-invalid': p('red', 600),
    'editor-locked': p('slate', 400),
    'editor-readonly-surface': `${p('slate', 500)}0f`,
    'editor-unsaved': p('amber', 500),
    'editor-error': p('red', 600),
    'editor-warning': p('amber', 600),
    'editor-grid': `${p('slate', 400)}33`,
  },
  dark: {
    'editor-selection': `${p('teal', 400)}29`,
    'editor-selection-border': p('teal', 400),
    'editor-selection-multi': `${p('teal', 400)}1a`,
    'editor-hover-outline': `${p('teal', 400)}80`,
    'editor-node-active': p('teal', 400),
    'editor-drag-preview': `${p('slate', 50)}1f`,
    'editor-drop-zone': `${p('teal', 400)}1f`,
    'editor-drop-zone-border': p('teal', 400),
    'editor-insertion': p('teal', 300),
    'editor-snap-guide': '#ff5fb0',
    'editor-align-guide': `${p('blue', 400)}b3`,
    'editor-resize-handle': p('teal', 400),
    'editor-resize-handle-fg': p('slate', 950),
    'editor-connection': p('slate', 500),
    'editor-connection-valid': p('green', 400),
    'editor-connection-invalid': p('red', 400),
    'editor-locked': p('slate', 600),
    'editor-readonly-surface': `${p('slate', 50)}0a`,
    'editor-unsaved': p('amber', 400),
    'editor-error': p('red', 400),
    'editor-warning': p('amber', 400),
    'editor-grid': `${p('slate', 400)}26`,
  },
}

/**
 * Chart tokens: twelve categorical series plus the annotation roles.
 *
 * `target` uses the brand, and that is the one deliberate exception to "charts do not use brand
 * teal". A target line is not a series — it is the goal the series is measured against, which is
 * the most brand-aligned concept on the chart. Series colours avoid the brand so nothing in the
 * data reads as interactive; an annotation is not data.
 */
const chartTokens = (theme) => {
  const series = Object.fromEntries(CHART[theme].map((hexValue, i) => [`chart-${i + 1}`, hexValue]))
  const isLight = theme === 'light'
  return {
    ...series,
    'chart-positive': p('green', isLight ? 600 : 400),
    'chart-negative': p('red', isLight ? 600 : 400),
    'chart-neutral': p('slate', isLight ? 500 : 500),
    'chart-baseline': p('slate', isLight ? 400 : 600),
    'chart-target': p('teal', isLight ? 600 : 400),
    'chart-reference': p('slate', isLight ? 300 : 700),
    // Forecast is the same hue as target at reduced alpha, because a forecast IS a projected
    // target — a different hue would imply a different quantity.
    'chart-forecast': `${p('teal', isLight ? 500 : 400)}80`,
    // Missing data must not read as a low value. Neutral and pale, and the chart layer is
    // expected to pair it with a hatch pattern: colour alone cannot say "unknown".
    'chart-missing': p('slate', isLight ? 200 : 800),
    'chart-grid': isLight ? `${p('slate', 400)}2e` : `${p('slate', 400)}1f`,
    'chart-axis': p('slate', isLight ? 400 : 600),
  }
}

export const CHART_TOKENS = { light: chartTokens('light'), dark: chartTokens('dark') }

/**
 * Domain tokens — and the deliberate decision to have very few.
 *
 * Applying colour to a training concept is easy and usually wrong, so the test applied here is:
 * **does this concept have an inherent direction that a colour would communicate truthfully?**
 *
 * Only two pass.
 *
 * `readiness` passes. Low readiness genuinely means "do less today", and that is exactly the
 * kind of instruction colour conveys well.
 *
 * `trend` passes as *direction*, not quality — up and down, not good and bad. A regression during
 * a planned deload is intended, and colouring it red would tell the athlete their programme is
 * failing when it is working.
 *
 * Everything else fails, and is assigned a stable CHART colour instead:
 *
 * - `strength`, `endurance`, `mobility`, `recovery` are **modalities**. They are categorical and
 *   carry no valence. Making "strength" red would imply danger; making it green would imply it is
 *   better than mobility. Neither is a claim the product should make.
 * - `load` and `fatigue` are **magnitudes without valence**, and this is the important one. High
 *   load is the *point* of training. Colouring it red teaches an athlete that training hard is
 *   dangerous — which is both false and directly counter to what the product is for. Fatigue is
 *   the same: it is the expected consequence of work, not a fault.
 *
 * The mapping below is a stable convention so a modality keeps its colour across every chart in
 * the product, without pretending the colour carries meaning.
 */
export const DOMAIN = {
  light: {
    'readiness-high': p('green', 600),
    'readiness-moderate': p('amber', 600),
    'readiness-low': p('red', 600),
    'trend-up': p('green', 600),
    'trend-down': p('red', 600),
    'trend-flat': p('slate', 500),
  },
  dark: {
    'readiness-high': p('green', 400),
    'readiness-moderate': p('amber', 400),
    'readiness-low': p('red', 400),
    'trend-up': p('green', 400),
    'trend-down': p('red', 400),
    'trend-flat': p('slate', 500),
  },
}

/** Modality → chart slot. A convention, not a semantic claim. */
export const MODALITY_CHART_SLOT = {
  strength: 1,
  endurance: 2,
  mobility: 3,
  recovery: 4,
  load: 5,
  fatigue: 6,
}
