const DISPLAY_FONT = "'Source Serif 4', 'Iowan Old Style', Georgia, serif"

export function ProcessingStep(): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-6 text-center">
      {/* Animated thrive-green spinner */}
      <div
        className="w-12 h-12 rounded-full border-[3px] border-t-transparent animate-spin"
        style={{ borderColor: 'var(--thrive-soft)', borderTopColor: 'var(--thrive)' }}
      />

      <div>
        <h2
          className="text-foreground mb-2 leading-tight"
          style={{ fontFamily: DISPLAY_FONT, fontSize: '24px', fontWeight: 400, fontStyle: 'italic' }}
        >
          Analyzing your items
        </h2>
        <p className="text-muted-foreground text-sm max-w-xs leading-relaxed">
          We're processing your photos and building your inventory. This takes about 15 seconds.
        </p>
      </div>
    </div>
  )
}
