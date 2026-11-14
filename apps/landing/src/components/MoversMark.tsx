interface MoversMarkProps {
  /** Height of the box icon in pixels; the wordmark scales with it. */
  size?: number
  /** Footer variant: lighter wordmark, no offset shadow on the icon. */
  compact?: boolean
  /** Accessible name of the mark. */
  title?: string
}

/** The Movers mark: an inked, taped cardboard box next to the wordmark. */
export function MoversMark({ size = 30, compact = false, title = 'Movers' }: MoversMarkProps) {
  return (
    <span className={`lp-mark${compact ? ' lp-mark--compact' : ''}`} role="img" aria-label={title}>
      <svg className="lp-mark__box" viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" focusable="false">
        <path
          d="M4 12h24v16H4z"
          fill="var(--lp-paper)"
          stroke="var(--lp-ink)"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <path
          d="M2 12 6.5 5h19L30 12z"
          fill="var(--lp-paper)"
          stroke="var(--lp-ink)"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <path d="M13 5h6v13h-6z" fill="var(--lp-tape)" stroke="var(--lp-ink)" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <span className="lp-mark__word" aria-hidden="true" style={{ fontSize: Math.round(size * 0.78) }}>
        Movers
      </span>
    </span>
  )
}
