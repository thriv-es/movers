/** The outline of the burst: a 13-point star, computed once. */
const BURST_POINTS = (() => {
  const spikes = 13
  const outer = 97
  const inner = 66
  const out: string[] = []
  for (let i = 0; i < spikes * 2; i++) {
    const radius = i % 2 === 0 ? outer : inner
    const angle = (Math.PI * 2 * i) / (spikes * 2) - Math.PI / 2
    // A little wobble so the burst reads as drawn rather than plotted.
    const wobble = 1 + Math.sin(i * 2.7) * 0.05 + Math.cos(i * 1.3) * 0.03
    const x = 100 + Math.cos(angle) * radius * wobble
    const y = 100 + Math.sin(angle) * radius * wobble
    out.push(`${x.toFixed(1)},${y.toFixed(1)}`)
  }
  return out.join(' ')
})()

/** A hand-inked comic burst: a wobbly star with a two-word label across it. */
export function ComicBurst({ label }: { label: string }) {
  const [first, second] = label.split(' ')

  return (
    <div className="lp-burst" data-lp-burst>
      <svg className="lp-burst__art" viewBox="0 0 200 200" role="img" aria-label={label}>
        <polygon
          points={BURST_POINTS}
          fill="var(--lp-tape)"
          stroke="var(--lp-ink)"
          strokeWidth="9"
          strokeLinejoin="round"
        />
        <g transform="rotate(-9 100 100)">
          <text x="100" y="93" textAnchor="middle" className="lp-burst__word">
            {first}
          </text>
          <text x="100" y="122" textAnchor="middle" className="lp-burst__word">
            {second}
          </text>
        </g>
      </svg>
    </div>
  )
}
