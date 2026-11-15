import { Hono } from 'hono'
import type { Bindings } from '../_lib/types'
import type { PublicMover } from '../../../src/data'
import { createStore } from '../_lib/store'

const movers = new Hono<{ Bindings: Bindings }>()

/** Active movers, trimmed to what the quote picker shows. */
movers.get('/', async (c) => {
  const list = await createStore(c.env).listMovers({ status: 'active' })
  const result: PublicMover[] = list.map(({ id, name, slug, serviceArea }) => ({ id, name, slug, serviceArea }))
  return c.json({ movers: result })
})

export default movers
