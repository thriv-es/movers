import { Button } from '@workspace/react-ui/components/ui/button'
import { Calendar } from 'lucide-react'

export function ScheduleStep(): JSX.Element {
  const scheduleUrl = import.meta.env.VITE_SCHEDULE_URL || 'https://calendar.google.com'

  return (
    <div className="space-y-6 text-center">
      <h2 className="~text-xl/2xl font-bold">Schedule Your Move</h2>
      <p className="text-muted-foreground">
        Ready to schedule your move? Click the button below to open our scheduling calendar.
      </p>
      <Button
        onClick={() => window.open(scheduleUrl, '_blank')}
        size="lg"
        className="w-full"
      >
        <Calendar className="w-4 h-4 mr-2" />
        Open Scheduling Calendar
      </Button>
      <p className="text-sm text-muted-foreground">
        Thank you for using our moving estimate service!
      </p>
    </div>
  )
}

