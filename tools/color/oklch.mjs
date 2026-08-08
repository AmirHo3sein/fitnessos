/**
 * Colour maths: OKLCH → sRGB, and WCAG relative luminance / contrast.
 *
 * The palette is designed in OKLCH rather than HSL because HSL's lightness is not
 * perceptual — `hsl(60 100% 50%)` (yellow) and `hsl(240 100% 50%)` (blue) claim the same
 * lightness and differ by roughly 8:1 in perceived brightness. A scale built in HSL
 * therefore has steps that feel evenly spaced in one hue and lurch in another, which is
 * exactly what makes hand-tuned palettes hand-tuned.
 *
 * OKLab's L is perceptually uniform, so one lightness ramp works across every hue and the
 * scales stay visually parallel. That is what lets `teal-600` and `red-600` carry the same
 * visual weight — which is the property the whole token system depends on.
 *
 * Implemented here rather than pulled from a library because it is forty lines of published
 * matrix arithmetic, runs at build time only, and a dependency would put a colour-space
 * conversion in the critical path of the design system for no benefit.
 */

/** OKLab → linear sRGB. Björn Ottosson's matrices. */
const oklabToLinearSrgb = (L, a, b) => {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b

  const l = l_ * l_ * l_
  const m = m_ * m_ * m_
  const s = s_ * s_ * s_

  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

const linearToSrgb = (c) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055

const srgbToLinear = (c) =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)

/**
 * Whether an OKLCH colour is representable in sRGB.
 *
 * Worth checking rather than assuming: OKLCH describes colours sRGB cannot show, and the
 * usual "just clamp it" produces a colour that is a different hue from the one specified —
 * silently, and only for the most saturated steps, which are the ones a brand cares about.
 */
export const inGamut = (L, C, H) => {
  const [r, g, b] = oklabToLinearSrgb(
    L,
    C * Math.cos((H * Math.PI) / 180),
    C * Math.sin((H * Math.PI) / 180),
  )
  const eps = 1e-4
  return r >= -eps && r <= 1 + eps && g >= -eps && g <= 1 + eps && b >= -eps && b <= 1 + eps
}

/** OKLCH → `#rrggbb`. Clamps, but `inGamut` should be checked first. */
export const oklchToHex = (L, C, H) => {
  const [lr, lg, lb] = oklabToLinearSrgb(
    L,
    C * Math.cos((H * Math.PI) / 180),
    C * Math.sin((H * Math.PI) / 180),
  )
  const to255 = (v) => Math.round(Math.min(1, Math.max(0, linearToSrgb(v))) * 255)
  return `#${[to255(lr), to255(lg), to255(lb)].map((n) => n.toString(16).padStart(2, '0')).join('')}`
}

/**
 * Reduce chroma until the colour fits sRGB, keeping L and H.
 *
 * Chroma is the right axis to give up. Clamping RGB channels shifts hue — a too-saturated
 * teal clips its blue channel and drifts green — and reducing lightness would break the
 * scale's parallel structure across hues, which is the one thing OKLCH was chosen for.
 */
export const fitGamut = (L, C, H) => {
  let lo = 0
  let hi = C
  if (inGamut(L, C, H)) return C
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2
    if (inGamut(L, mid, H)) lo = mid
    else hi = mid
  }
  return lo
}

export const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** WCAG 2.1 relative luminance. */
export const luminance = (hex) => {
  const [r, g, b] = hexToRgb(hex).map((v) => srgbToLinear(v / 255))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2.1 contrast ratio, 1..21. */
export const contrast = (a, b) => {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

export const ratio = (a, b) => Math.round(contrast(a, b) * 100) / 100

/**
 * Composite a translucent colour over an opaque one.
 *
 * Needed because several tokens are alpha-based — borders, overlays, hover fills — and WCAG
 * contrast is only defined for opaque colours. Checking the rgba value directly would report
 * a ratio nobody ever sees.
 */
export const over = (fgHex, alpha, bgHex) => {
  const f = hexToRgb(fgHex)
  const b = hexToRgb(bgHex)
  const mix = f.map((c, i) => Math.round(c * alpha + b[i] * (1 - alpha)))
  return `#${mix.map((n) => n.toString(16).padStart(2, '0')).join('')}`
}
