import { useCallback, useEffect, useState } from 'react'
import { Badge, Button, Field, Input, Panel, Select } from '@movers/ui'
import type { MoverInput, MoverRecord, MoverStatus } from '@/data'
import { createMover, formatDateTime, listMovers, toMessage, updateMover } from '@/lib/admin-api'

const MOVER_STATUSES: MoverStatus[] = ['active', 'inactive']

function isMoverStatus(value: string): value is MoverStatus {
  return (MOVER_STATUSES as string[]).includes(value)
}

const EMPTY_FORM: MoverInput = { name: '', email: '', website: '', serviceArea: '', status: 'active' }

type FormErrors = Partial<Record<'name' | 'email', string>>

type Editing = { mode: 'create' } | { mode: 'edit'; mover: MoverRecord }

export default function MoversPage() {
  const [movers, setMovers] = useState<MoverRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setListError(null)
    try {
      setMovers(await listMovers())
    } catch (error) {
      setListError(toMessage(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="mv-stack">
      <div className="mv-row">
        <Button type="button" variant="primary" onClick={() => setEditing({ mode: 'create' })}>
          Add mover
        </Button>
        <Button type="button" onClick={() => void load()} disabled={loading}>
          Refresh
        </Button>
      </div>

      {listError ? <Panel tone="kraft">Could not load movers: {listError}</Panel> : null}

      {editing ? (
        <MoverForm
          key={editing.mode === 'edit' ? editing.mover.id : 'create'}
          editing={editing}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void load()
          }}
        />
      ) : null}

      <div className="mv-table--wrap">
        <table className="mv-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Website</th>
              <th>Service area</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {movers.length === 0 ? (
              <tr>
                <td colSpan={7} className="mv-muted">
                  {loading ? 'Loading movers...' : 'No movers yet.'}
                </td>
              </tr>
            ) : (
              movers.map((mover) => (
                <tr key={mover.id}>
                  <td>{mover.name}</td>
                  <td>
                    <a href={`mailto:${mover.email}`}>{mover.email}</a>
                  </td>
                  <td>
                    {mover.website ? (
                      <a href={mover.website} target="_blank" rel="noreferrer">
                        {mover.website}
                      </a>
                    ) : (
                      <span className="mv-muted">none</span>
                    )}
                  </td>
                  <td>{mover.serviceArea || <span className="mv-muted">none</span>}</td>
                  <td>
                    <Badge tone={mover.status === 'active' ? 'green' : 'ink'}>{mover.status}</Badge>
                  </td>
                  <td className="adm-nowrap">{formatDateTime(mover.createdAt)}</td>
                  <td>
                    <Button type="button" size="sm" onClick={() => setEditing({ mode: 'edit', mover })}>
                      Edit
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

interface MoverFormProps {
  editing: Editing
  onCancel: () => void
  onSaved: () => void
}

function MoverForm({ editing, onCancel, onSaved }: MoverFormProps) {
  const initial: MoverInput =
    editing.mode === 'edit'
      ? {
          name: editing.mover.name,
          email: editing.mover.email,
          website: editing.mover.website,
          serviceArea: editing.mover.serviceArea,
          status: editing.mover.status,
        }
      : EMPTY_FORM
  const [form, setForm] = useState<MoverInput>(initial)
  const [errors, setErrors] = useState<FormErrors>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const set = <K extends keyof MoverInput>(key: K, value: MoverInput[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const validate = (): FormErrors => {
    const next: FormErrors = {}
    if (!form.name.trim()) next.name = 'Name is required.'
    if (!form.email.trim()) next.email = 'Email is required.'
    return next
  }

  const submit = async () => {
    const next = validate()
    setErrors(next)
    if (Object.keys(next).length > 0) return
    setSaving(true)
    setSaveError(null)
    try {
      const input: MoverInput = {
        name: form.name.trim(),
        email: form.email.trim(),
        website: form.website.trim(),
        serviceArea: form.serviceArea.trim(),
        status: form.status,
      }
      if (editing.mode === 'edit') await updateMover(editing.mover.id, input)
      else await createMover(input)
      onSaved()
    } catch (caught) {
      setSaveError(toMessage(caught))
    } finally {
      setSaving(false)
    }
  }

  const title = editing.mode === 'edit' ? `Edit ${editing.mover.name}` : 'Add mover'

  return (
    <Panel
      as="form"
      flat
      aria-label={title}
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div className="mv-stack">
        <h2 className="mv-title mv-title--md">{title}</h2>
        <div className="adm-form">
          <Field label="Name" htmlFor="mover-name" error={errors.name}>
            <Input
              id="mover-name"
              value={form.name}
              invalid={Boolean(errors.name)}
              onChange={(event) => set('name', event.target.value)}
            />
          </Field>
          <Field label="Email" htmlFor="mover-email" error={errors.email}>
            <Input
              id="mover-email"
              type="email"
              value={form.email}
              invalid={Boolean(errors.email)}
              onChange={(event) => set('email', event.target.value)}
            />
          </Field>
          <Field label="Website" htmlFor="mover-website" help="Optional">
            <Input
              id="mover-website"
              type="url"
              placeholder="https://"
              value={form.website}
              onChange={(event) => set('website', event.target.value)}
            />
          </Field>
          <Field label="Service area" htmlFor="mover-area" help="Optional">
            <Input
              id="mover-area"
              value={form.serviceArea}
              onChange={(event) => set('serviceArea', event.target.value)}
            />
          </Field>
          <Field label="Status" htmlFor="mover-status">
            <Select
              id="mover-status"
              value={form.status}
              onChange={(event) => {
                const value = event.target.value
                if (isMoverStatus(value)) set('status', value)
              }}
            >
              {MOVER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {saveError ? <Panel tone="kraft">Could not save mover: {saveError}</Panel> : null}
        <div className="mv-actions">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </Panel>
  )
}
