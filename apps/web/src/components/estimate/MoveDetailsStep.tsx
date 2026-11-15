import { Button, Caption, Field, Input, Select } from '@movers/ui'
import { type FormEvent, useState } from 'react'
import type { MoveDetails } from '@/data'

interface MoveDetailsStepProps {
  moveDetails: MoveDetails
  onBack: () => void
  onContinue: (details: MoveDetails) => void
}

type Draft = Record<keyof MoveDetails, string>

const toDraft = (details: MoveDetails): Draft => ({
  from: details.from ?? '',
  to: details.to ?? '',
  date: details.date ?? '',
  distanceMiles: details.distanceMiles === null ? '' : String(details.distanceMiles),
  originFloor: details.originFloor === null ? '' : String(details.originFloor),
  destinationFloor: details.destinationFloor === null ? '' : String(details.destinationFloor),
  originElevator: details.originElevator === null ? '' : details.originElevator ? 'yes' : 'no',
  destinationElevator: details.destinationElevator === null ? '' : details.destinationElevator ? 'yes' : 'no',
})

const numberOrNull = (text: string, integer = false): number | null => {
  if (text.trim() === '') return null
  const value = Number(text)
  if (!Number.isFinite(value)) return null
  return integer ? Math.round(value) : value
}

const boolOrNull = (text: string): boolean | null => (text === '' ? null : text === 'yes')

export function draftToDetails(draft: Draft): MoveDetails {
  return {
    from: draft.from.trim() || null,
    to: draft.to.trim() || null,
    date: draft.date.trim() || null,
    distanceMiles: numberOrNull(draft.distanceMiles),
    originFloor: numberOrNull(draft.originFloor, true),
    destinationFloor: numberOrNull(draft.destinationFloor, true),
    originElevator: boolOrNull(draft.originElevator),
    destinationElevator: boolOrNull(draft.destinationElevator),
  }
}

export function validateDetails(details: MoveDetails): Partial<Record<keyof MoveDetails, string>> {
  const errors: Partial<Record<keyof MoveDetails, string>> = {}
  if (!details.from) errors.from = 'Where are you moving from?'
  if (!details.to) errors.to = 'Where are you moving to?'
  if (details.distanceMiles === null) errors.distanceMiles = 'Roughly how many miles is the move?'
  else if (details.distanceMiles < 0) errors.distanceMiles = 'Distance cannot be negative.'
  if (details.originFloor !== null && details.originFloor < 1) errors.originFloor = 'Use 1 for the ground floor.'
  if (details.destinationFloor !== null && details.destinationFloor < 1)
    errors.destinationFloor = 'Use 1 for the ground floor.'
  return errors
}

/** Step 2: the move details card. Everything the chat learned, editable, with the three required fields enforced. */
export function MoveDetailsStep({ moveDetails, onBack, onContinue }: MoveDetailsStepProps): JSX.Element {
  const [draft, setDraft] = useState<Draft>(() => toDraft(moveDetails))
  const [errors, setErrors] = useState<Partial<Record<keyof MoveDetails, string>>>({})

  const set = (key: keyof MoveDetails) => (event: { target: { value: string } }) =>
    setDraft((current) => ({ ...current, [key]: event.target.value }))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const details = draftToDetails(draft)
    const found = validateDetails(details)
    setErrors(found)
    if (Object.keys(found).length === 0) onContinue(details)
  }

  const errorCount = Object.keys(errors).length

  return (
    <form className="mv-panel est-form" onSubmit={submit} noValidate aria-label="Move details">
      <Caption accent="tape">Your move details</Caption>
      <p className="mv-lede">Check what we picked up from the chat. These numbers drive the price.</p>
      <div className="est-grid">
        <Field label="Moving from" htmlFor="md-from" error={errors.from}>
          <Input
            id="md-from"
            value={draft.from}
            onChange={set('from')}
            invalid={Boolean(errors.from)}
            autoComplete="off"
          />
        </Field>
        <Field label="Moving to" htmlFor="md-to" error={errors.to}>
          <Input id="md-to" value={draft.to} onChange={set('to')} invalid={Boolean(errors.to)} autoComplete="off" />
        </Field>
        <Field label="Distance (miles)" htmlFor="md-distance" error={errors.distanceMiles}>
          <Input
            id="md-distance"
            type="number"
            inputMode="decimal"
            min={0}
            value={draft.distanceMiles}
            onChange={set('distanceMiles')}
            invalid={Boolean(errors.distanceMiles)}
          />
        </Field>
        <Field label="Move date" htmlFor="md-date" help="Optional">
          <Input id="md-date" type="date" value={draft.date} onChange={set('date')} />
        </Field>
        <Field label="Floor at origin" htmlFor="md-ofloor" help="1 is the ground floor" error={errors.originFloor}>
          <Input
            id="md-ofloor"
            type="number"
            inputMode="numeric"
            min={1}
            value={draft.originFloor}
            onChange={set('originFloor')}
          />
        </Field>
        <Field label="Elevator at origin" htmlFor="md-oelev">
          <Select id="md-oelev" value={draft.originElevator} onChange={set('originElevator')}>
            <option value="">Not sure</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </Select>
        </Field>
        <Field label="Floor at destination" htmlFor="md-dfloor" error={errors.destinationFloor}>
          <Input
            id="md-dfloor"
            type="number"
            inputMode="numeric"
            min={1}
            value={draft.destinationFloor}
            onChange={set('destinationFloor')}
          />
        </Field>
        <Field label="Elevator at destination" htmlFor="md-delev">
          <Select id="md-delev" value={draft.destinationElevator} onChange={set('destinationElevator')}>
            <option value="">Not sure</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </Select>
        </Field>
      </div>
      {errorCount > 0 ? (
        <p className="est-error" role="alert">
          Fill in the highlighted fields to continue.
        </p>
      ) : null}
      <div className="mv-actions">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" variant="primary">
          Continue to photos
        </Button>
      </div>
    </form>
  )
}
