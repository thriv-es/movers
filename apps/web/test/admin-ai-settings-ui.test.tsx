import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { HelmetProvider } from 'react-helmet-async'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AdminLayout from '../src/pages/admin/admin.layout'
import AiSettingsPage from '../src/pages/admin/ai-settings.page'

const roles = {
  chat: { backend: 'gateway', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' },
  price: { backend: 'gateway', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' },
  vision: { backend: 'gateway', model: '@cf/meta/llama-3.2-11b-vision-instruct' },
}
const payload = {
  settings: { revision: 0, roles },
  effective: {
    chat: { mode: 'mock', available: true },
    price: { mode: 'gateway', available: false },
    vision: { mode: 'gateway', available: true },
  },
  catalog: {
    chat: [
      { model: roles.chat.model, label: 'Llama 3.3 70B' },
      {
        model: '@cf/meta/llama-3.1-8b-instruct-fp8-fast',
        label: 'Llama 3.1 8B',
        caveat: 'May not follow the session prompt.',
      },
    ],
    price: [{ model: roles.price.model, label: 'Llama 3.3 70B' }],
    vision: [{ model: roles.vision.model, label: 'Llama 3.2 Vision' }],
  },
}

function mount(env: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      if (input === '/api/admin/status') return Response.json({ env, storage: 'd1' })
      if (input === '/api/admin/ai-settings' && init?.method === 'PATCH')
        return Response.json({ error: 'Settings changed; reload and retry.' }, { status: 409 })
      if (input === '/api/admin/ai-settings') return Response.json(payload)
      throw Error(`Unexpected fetch: ${input}`)
    }),
  )
  const router = createMemoryRouter(
    [
      {
        path: '/admin',
        element: <AdminLayout />,
        children: [
          { path: 'ai-settings', element: <AiSettingsPage /> },
          { path: 'leads', element: <p>Leads list</p> },
        ],
      },
    ],
    { initialEntries: ['/admin/ai-settings'] },
  )
  render(
    <HelmetProvider>
      <RouterProvider router={router} />
    </HelmetProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('Admin AI settings page', () => {
  it('groups role cards, displays saved/effective modes and exposes provider/model controls without credentials', async () => {
    mount('development')
    expect(await screen.findByRole('link', { name: 'AI settings' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Text' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Images' })).toBeInTheDocument()
    for (const role of ['Chat', 'Pricing', 'Vision']) {
      const card = screen.getByRole('group', { name: role })
      expect(within(card).getByRole('combobox', { name: 'Provider' })).toBeInTheDocument()
      expect(within(card).getByRole('combobox', { name: 'Model' })).toBeInTheDocument()
    }
    expect(screen.getByText(/Offline mock/)).toBeInTheDocument()
    expect(screen.getByText(/Provider unavailable/)).toBeInTheDocument()
    expect(screen.getByText(/revision 0/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/token|api key|credential/i)).toBeNull()
  })

  it('hides settings navigation and page in preview even at the direct URL', async () => {
    mount('preview')
    expect(await screen.findByRole('link', { name: 'Leads' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'AI settings' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Text' })).toBeNull()
  })

  it('disables save during PATCH and displays the returned revision', async () => {
    mount('development')
    const button = await screen.findByRole('button', { name: 'Save settings' })
    let complete: ((response: Response) => void) | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            complete = resolve
          }),
      ),
    )
    fireEvent.click(button)
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled()
    complete?.(Response.json({ ...payload, settings: { ...payload.settings, revision: 1 } }))
    expect(await screen.findByText(/revision 1/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save settings' })).not.toBeDisabled()
  })

  it('sends current revision and selections and surfaces conflict errors', async () => {
    mount('development')
    const price = await screen.findByRole('group', { name: 'Pricing' })
    fireEvent.change(within(price).getByRole('combobox', { name: 'Provider' }), { target: { value: 'binding' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    await waitFor(() => expect(screen.getByText('Settings changed; reload and retry.')).toBeInTheDocument())
    expect(fetch).toHaveBeenCalledWith(
      '/api/admin/ai-settings',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          expectedRevision: 0,
          roles: { ...roles, price: { ...roles.price, backend: 'binding' } },
        }),
      }),
    )
  })
})
