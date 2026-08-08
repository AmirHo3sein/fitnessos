import { PALETTE, STEPS, CHART } from './palette.mjs'
import { ratio } from './oklch.mjs'
const W='#ffffff'
for (const [name, scale] of Object.entries(PALETTE)) {
  console.log('\n' + name.toUpperCase())
  for (const s of STEPS) {
    const h = scale[s].hex
    console.log(`  ${String(s).padStart(3)} ${h}  C=${String(scale[s].C).padEnd(6)} vsWhite ${String(ratio(h,W)).padStart(5)}  vsSlate950 ${String(ratio(h, PALETTE.slate[950].hex)).padStart(5)}`)
  }
}
console.log('\nCHART light:', CHART.light.join(' '))
console.log('CHART dark: ', CHART.dark.join(' '))
