import { Calendar, CheckCircle } from 'lucide-react'

const DISPLAY_FONT = "'Source Serif 4', 'Iowan Old Style', Georgia, serif"

export function ScheduleStep(): JSX.Element {
  const scheduleUrl = import.meta.env.VITE_SCHEDULE_URL || 'https://calendar.google.com'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="text-eyebrow mb-2">Step 05</p>
        <h2
          className="text-foreground leading-tight mb-1.5"
          style={{ fontFamily: DISPLAY_FONT, fontSize: '26px', fontWeight: 400, fontStyle: 'italic' }}
        >
          Schedule your move
        </h2>
        <p className="text-muted-foreground text-sm">
          Pick a date that works for you. We'll confirm within 24 hours.
        </p>
      </div>

      {/* Success note */}
      <div
        className="flex items-start gap-3 rounded-xl px-4 py-4"
        style={{ backgroundColor: 'var(--thrive-soft)' }}
      >
        <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--thrive)' }} />
        <div>
          <p className="text-sm font-medium text-foreground">Your estimate is ready</p>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            We've saved your inventory and price breakdown. Open the calendar to book your move date.
          </p>
        </div>
      </div>

      {/* Calendar CTA */}
      <button
        onClick={() => window.open(scheduleUrl, '_blank')}
        className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full font-medium text-base text-white btn-lift"
        style={{ backgroundColor: 'var(--thrive)' }}
      >
        <Calendar className="w-4 h-4" />
        Open scheduling calendar
      </button>

      <p
        className="text-center text-sm text-muted-foreground italic"
        style={{ fontFamily: DISPLAY_FONT }}
      >
        Thank you for using thriv.es movers.
      </p>
    </div>
  )
}
