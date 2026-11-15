import { Badge, Button, Caption, Field, Input, Panel } from '@movers/ui'
import { type FormEvent, useState } from 'react'
import type { Contact, MoveDetails } from '@/data'
import { attachContact } from '@/lib/api-client'

interface ScheduleStepProps {
  estimateId: string | null
  moveDetails: MoveDetails
  contact: Contact | null
  onScheduled: (contact: Contact, reference: string) => void
  onBack: () => void
  onStartOver: () => void
}

const todayIso = () => new Date().toISOString().slice(0, 10)

/** Step 6: contact details and a requested date, attached to the saved estimate. */
export function ScheduleStep({
  estimateId,
  moveDetails,
  contact,
  onScheduled,
  onBack,
  onStartOver,
}: ScheduleStepProps): JSX.Element {
  const [name, setName] = useState(contact?.name ?? '')
  const [email, setEmail] = useState(contact?.email ?? '')
  const [phone, setPhone] = useState(contact?.phone ?? '')
  const [date, setDate] = useState(contact?.requestedDate ?? moveDetails.date ?? '')
  const [errors, setErrors] = useState<Partial<Record<'name' | 'email' | 'date', string>>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reference, setReference] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const found: typeof errors = {}
    if (!name.trim()) found.name = 'We need a name for the booking.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) found.email = 'Enter an email we can reach you at.'
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) found.date = 'Pick a date.'
    setErrors(found)
    if (Object.keys(found).length > 0) return
    if (!estimateId) {
      setError('The estimate was not saved. Go back to the estimate step and try again.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const details: Contact = { name: name.trim(), email: email.trim(), phone: phone.trim(), requestedDate: date }
      const result = await attachContact(estimateId, details)
      setReference(result.reference)
      onScheduled(details, result.reference)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save your request. Try again.')
    } finally {
      setBusy(false)
    }
  }

  if (reference || contact) {
    return (
      <Panel as="section" className="mv-stack" aria-label="Request received">
        <div className="mv-row est-upload__head">
          <Caption accent="green">Request received</Caption>
        </div>
        <p className="mv-lede">
          Thanks{contact?.name ? `, ${contact.name}` : ''}. A mover will confirm the date and the final price by email.
        </p>
        {reference ? <Badge tone="green">Reference {reference}</Badge> : null}
        <dl className="est-dl">
          <div className="est-dl__row">
            <dt>Requested date</dt>
            <dd>{contact?.requestedDate ?? date}</dd>
          </div>
          <div className="est-dl__row">
            <dt>Email</dt>
            <dd>{contact?.email ?? email}</dd>
          </div>
        </dl>
        <div className="mv-actions">
          <Button variant="ghost" onClick={onBack}>
            Back to the estimate
          </Button>
          <Button variant="tape" onClick={onStartOver}>
            Start another estimate
          </Button>
        </div>
      </Panel>
    )
  }

  return (
    <form className="mv-panel est-form" onSubmit={submit} noValidate aria-label="Schedule your move">
      <div className="mv-row est-upload__head">
        <Caption accent="tape">Schedule the move</Caption>
      </div>
      <p className="mv-lede">Tell us when and how to reach you. No payment, no commitment yet.</p>
      <div className="est-grid">
        <Field label="Your name" htmlFor="sc-name" error={errors.name}>
          <Input
            id="sc-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            invalid={Boolean(errors.name)}
            autoComplete="name"
          />
        </Field>
        <Field label="Email" htmlFor="sc-email" error={errors.email}>
          <Input
            id="sc-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            invalid={Boolean(errors.email)}
            autoComplete="email"
          />
        </Field>
        <Field label="Phone" htmlFor="sc-phone" help="Optional">
          <Input id="sc-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
        </Field>
        <Field label="Preferred move date" htmlFor="sc-date" error={errors.date}>
          <Input
            id="sc-date"
            type="date"
            min={todayIso()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            invalid={Boolean(errors.date)}
          />
        </Field>
      </div>
      {error ? (
        <p className="est-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mv-actions">
        <Button variant="ghost" onClick={onBack} disabled={busy}>
          Back
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Sending...' : 'Request this date'}
        </Button>
      </div>
    </form>
  )
}
