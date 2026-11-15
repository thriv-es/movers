import { useEffect, useState } from 'react'
import { Badge, Button, Field, Panel, Select } from '@movers/ui'
import { adminAiSettings, saveAdminAiSettings, toMessage } from '@/lib/admin-api'
import type { AdminAiSettings, AiRole, AiSelection } from '@/lib/admin-api'

const GROUPS: { title: string; roles: { role: AiRole; label: string }[] }[] = [
  {
    title: 'Text',
    roles: [
      { role: 'chat', label: 'Chat' },
      { role: 'price', label: 'Pricing' },
    ],
  },
  { title: 'Images', roles: [{ role: 'vision', label: 'Vision' }] },
]

export default function AiSettingsPage() {
  const [data, setData] = useState<AdminAiSettings | null>(null)
  const [draft, setDraft] = useState<Record<AiRole, AiSelection> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    adminAiSettings()
      .then((result) => {
        if (cancelled) return
        setData(result)
        setDraft(result.settings.roles)
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(toMessage(caught))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const select = (role: AiRole, selection: AiSelection) => {
    setDraft((previous) => (previous ? { ...previous, [role]: selection } : previous))
    setError(null)
  }

  const save = async () => {
    if (!data || !draft || saving) return
    setSaving(true)
    setError(null)
    try {
      const updated = await saveAdminAiSettings(data.settings.revision, draft)
      setData(updated)
      setDraft(updated.settings.roles)
    } catch (caught) {
      setError(toMessage(caught))
    } finally {
      setSaving(false)
    }
  }

  if (!data || !draft)
    return error ? (
      <Panel tone="kraft">Could not load AI settings: {error}</Panel>
    ) : (
      <p className="mv-muted">Loading AI settings...</p>
    )

  return (
    <div className="mv-stack">
      <p className="mv-muted">
        Local AI settings · revision {data.settings.revision}. Provider credentials are configured outside this page.
      </p>
      {GROUPS.map((group) => (
        <section key={group.title} className="mv-stack" aria-label={group.title}>
          <h2 className="mv-title mv-title--md">{group.title}</h2>
          <div className="adm-ai-cards">
            {group.roles.map(({ role, label }) => {
              const saved = data.settings.roles[role]
              const effective = data.effective[role]
              return (
                <Panel key={role} role="group" aria-label={label} className="adm-ai-card">
                  <h3 className="adm-section">{label}</h3>
                  <p className="mv-muted">
                    Saved: {saved.backend} · {saved.model}
                  </p>
                  <div className="mv-row">
                    <Badge tone="paper">Effective: {effective.mode}</Badge>
                    {effective.mode === 'mock' ? <Badge tone="tape">Offline mock</Badge> : null}
                    {!effective.available ? <Badge tone="tape">Provider unavailable</Badge> : null}
                  </div>
                  <div className="adm-form">
                    <Field label="Provider" htmlFor={`${role}-provider`}>
                      <Select
                        id={`${role}-provider`}
                        value={draft[role].backend}
                        disabled={saving}
                        onChange={(event) => {
                          const backend = event.target.value
                          if (backend === 'gateway' || backend === 'binding') select(role, { ...draft[role], backend })
                        }}
                      >
                        <option value="gateway">Gateway</option>
                        <option value="binding">Workers AI binding</option>
                      </Select>
                    </Field>
                    <Field label="Model" htmlFor={`${role}-model`}>
                      <Select
                        id={`${role}-model`}
                        value={draft[role].model}
                        disabled={saving}
                        onChange={(event) => {
                          const model = event.target.value
                          if (data.catalog[role].some((option) => option.model === model))
                            select(role, { ...draft[role], model })
                        }}
                      >
                        {data.catalog[role].map((option) => (
                          <option key={option.model} value={option.model}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  {data.catalog[role].find((option) => option.model === draft[role].model)?.caveat ? (
                    <p className="mv-muted">
                      {data.catalog[role].find((option) => option.model === draft[role].model)?.caveat}
                    </p>
                  ) : null}
                </Panel>
              )
            })}
          </div>
        </section>
      ))}
      {error ? (
        <Panel tone="kraft" role="alert">
          {error}
        </Panel>
      ) : null}
      <div className="mv-actions">
        <Button type="button" variant="primary" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving...' : 'Save settings'}
        </Button>
      </div>
    </div>
  )
}
