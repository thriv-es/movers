#!/usr/bin/env node
/**
 * Seeds demo data through the public and admin HTTP APIs, so the admin pages have something to show:
 * six movers, ten leads in every status, contacts, quote requests (some already replied) and operator notes.
 *
 *   pnpm dev                                                  # in another terminal
 *   pnpm seed                                                 # http://localhost:4610
 *   MOVERS_URL=https://dev.movers-ee0.pages.dev pnpm seed     # a preview deployment
 *   pnpm seed -- --force                                      # add the leads again even if seed data exists
 *
 * Movers are matched by email and never duplicated. Leads are tagged with a note starting with `Seed:`; without
 * `--force` the script stops when such a lead already exists. The admin API answers 404 in production, so this
 * only works against local dev and preview deployments. Plain Node 22+, no dependencies.
 */

const BASE_URL = (process.env.MOVERS_URL ?? 'http://localhost:4610').replace(/\/+$/, '')
const FORCE = process.argv.includes('--force')
const SEED_TAG = 'Seed:'

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const MOVERS = [
  {
    name: 'Bay State Relocation',
    email: 'quotes@baystate-relo.example',
    website: 'https://baystate-relo.example',
    serviceArea: 'Boston and the North Shore',
  },
  {
    name: 'Lone Star Relocation',
    email: 'hello@lonestar-relo.example',
    website: 'https://lonestar-relo.example',
    serviceArea: 'Austin, Dallas and Houston',
  },
  {
    name: 'Golden Gate Movers',
    email: 'dispatch@goldengatemovers.example',
    website: 'https://goldengatemovers.example',
    serviceArea: 'San Francisco Bay Area',
  },
  {
    name: 'Peachtree Van Lines',
    email: 'ops@peachtreevanlines.example',
    website: 'https://peachtreevanlines.example',
    serviceArea: 'Atlanta metro, long distance on request',
  },
  {
    name: 'Windy City Haulers',
    email: 'book@windycityhaulers.example',
    website: '',
    serviceArea: 'Chicago and suburbs',
  },
  {
    name: 'Cactus Crate and Carry',
    email: 'team@cactuscrate.example',
    website: '',
    serviceArea: 'Phoenix and Tucson',
    status: 'inactive',
  },
]

/** Room presets: the items a vision model would list, with volume and box range. */
const HOMES = {
  studio: {
    items: [
      ['Bed (full)', 1],
      ['Nightstand', 1],
      ['Dresser', 1],
      ['Sofa (loveseat)', 1],
      ['Coffee table', 1],
      ['TV (43 inch)', 1],
      ['TV stand', 1],
      ['Bookshelf', 1],
      ['Desk', 1],
      ['Office chair', 1],
      ['Floor lamp', 1],
      ['Small moving box packed', 8],
      ['Medium moving box packed', 6],
    ],
    volume: 420,
    boxes: [14, 20],
    note: 'Open-plan studio; closet and kitchen cabinets counted as 6 to 8 boxes.',
    special: [],
    duplicates: [],
    unseen: ['Hall closet'],
  },
  oneBed: {
    items: [
      ['Bed (queen)', 1],
      ['Nightstand', 2],
      ['Dresser', 1],
      ['Wardrobe box', 2],
      ['Sofa (3 seat)', 1],
      ['Armchair', 1],
      ['Coffee table', 1],
      ['TV (55 inch)', 1],
      ['TV stand', 1],
      ['Dining table (4 seat)', 1],
      ['Dining chair', 4],
      ['Bookshelf', 2],
      ['Bicycle', 1],
      ['Medium moving box packed', 12],
      ['Large moving box packed', 5],
    ],
    volume: 680,
    boxes: [22, 30],
    note: 'Bedroom, living room and kitchen seen; books fill two bookshelves (about 8 small boxes).',
    special: [{ item: 'TV (55 inch)', reason: 'Flat screen: needs a TV box or blanket wrap' }],
    duplicates: [{ item: 'Coffee table', count: 2 }],
    unseen: ['Bathroom', 'Balcony'],
  },
  twoBedFamily: {
    items: [
      ['Bed (king)', 1],
      ['Bed (twin)', 2],
      ['Crib', 1],
      ['Nightstand', 3],
      ['Dresser', 2],
      ['Wardrobe box', 4],
      ['Sofa (sectional)', 1],
      ['Armchair', 2],
      ['Coffee table', 1],
      ['TV (65 inch)', 1],
      ['TV (43 inch)', 1],
      ['Dining table (6 seat)', 1],
      ['Dining chair', 6],
      ['Bookshelf', 3],
      ['Desk', 1],
      ['Office chair', 1],
      ['Toy chest', 2],
      ['Washer', 1],
      ['Dryer', 1],
      ['Medium moving box packed', 25],
      ['Large moving box packed', 12],
    ],
    volume: 1350,
    boxes: [45, 60],
    note: 'Three bedrooms of furniture plus a playroom; kitchen counted as 12 boxes, garage not shown.',
    special: [
      { item: 'Sofa (sectional)', reason: 'Bulky: needs two movers and disassembly' },
      { item: 'Washer', reason: 'Appliance: disconnect and strap the drum' },
    ],
    duplicates: [{ item: 'Nightstand', count: 3 }],
    unseen: ['Garage', 'Attic'],
  },
  threeBedHouse: {
    items: [
      ['Bed (king)', 1],
      ['Bed (queen)', 1],
      ['Bed (twin)', 1],
      ['Nightstand', 4],
      ['Dresser', 3],
      ['Wardrobe box', 6],
      ['Sofa (3 seat)', 2],
      ['Armchair', 2],
      ['Recliner', 1],
      ['Coffee table', 1],
      ['Side table', 3],
      ['TV (75 inch)', 1],
      ['TV (50 inch)', 1],
      ['Dining table (8 seat)', 1],
      ['Dining chair', 8],
      ['China cabinet', 1],
      ['Upright piano', 1],
      ['Bookshelf', 4],
      ['Desk', 2],
      ['Office chair', 2],
      ['Treadmill', 1],
      ['Refrigerator', 1],
      ['Washer', 1],
      ['Dryer', 1],
      ['Patio table', 1],
      ['Patio chair', 4],
      ['Grill', 1],
      ['Medium moving box packed', 40],
      ['Large moving box packed', 20],
    ],
    volume: 2300,
    boxes: [75, 95],
    note: 'Whole house including patio; an upright piano and a china cabinet need specialists.',
    special: [
      { item: 'Upright piano', reason: 'Piano: specialist crew and a piano board' },
      { item: 'China cabinet', reason: 'Fragile glass: crating recommended' },
      { item: 'Treadmill', reason: 'Heavy: two movers, partial disassembly' },
    ],
    duplicates: [{ item: 'Sofa (3 seat)', count: 2 }],
    unseen: ['Basement', 'Garden shed'],
  },
  smallOffice: {
    items: [
      ['Desk', 6],
      ['Office chair', 8],
      ['Filing cabinet (4 drawer)', 4],
      ['Conference table', 1],
      ['Monitor', 10],
      ['Printer (floor model)', 1],
      ['Whiteboard', 2],
      ['Bookshelf', 3],
      ['Mini fridge', 1],
      ['Server rack (half height)', 1],
      ['Small moving box packed', 20],
      ['Medium moving box packed', 15],
    ],
    volume: 900,
    boxes: [35, 45],
    note: 'Six-desk office; files packed in small boxes, monitors need individual boxes.',
    special: [
      { item: 'Server rack (half height)', reason: 'IT equipment: anti-static wrap, keep upright' },
      { item: 'Printer (floor model)', reason: 'Heavy: dolly and two movers' },
    ],
    duplicates: [],
    unseen: ['Storage room'],
  },
}

/** Leads in the order they are created. Statuses are reached through the same API calls the app makes. */
const LEADS = [
  {
    home: 'studio',
    from: '88 Beacon St, Boston, MA 02108',
    to: '14 Pleasant St, Cambridge, MA 02139',
    date: '2026-12-05',
    miles: 3,
    floors: [4, 2],
    elevators: [true, false],
    status: 'new',
  },
  {
    home: 'oneBed',
    from: '2100 Guadalupe St, Austin, TX 78705',
    to: '5400 Ross Ave, Dallas, TX 75206',
    date: '2026-12-12',
    miles: 195,
    floors: [2, 1],
    elevators: [false, false],
    status: 'contacted',
    contact: { name: 'Priya Natarajan', email: 'priya.n@example.com', phone: '+1 512 555 0147' },
  },
  {
    home: 'twoBedFamily',
    from: '450 Fillmore St, San Francisco, CA 94117',
    to: '1200 Lincoln Ave, San Jose, CA 95125',
    date: '2026-12-19',
    miles: 48,
    floors: [3, 1],
    elevators: [false, false],
    status: 'quoted',
    contact: { name: 'Marcus Lee', email: 'marcus.lee@example.com', phone: '+1 415 555 0123' },
    quotes: ['Golden Gate Movers', 'Bay State Relocation'],
    replied: ['Golden Gate Movers'],
  },
  {
    home: 'threeBedHouse',
    from: '310 Peachtree Rd NE, Atlanta, GA 30305',
    to: '77 Lakeshore Dr, Chicago, IL 60611',
    date: '2027-01-09',
    miles: 720,
    floors: [1, 12],
    elevators: [false, true],
    status: 'won',
    contact: { name: 'The Okafor family', email: 'ada.okafor@example.com', phone: '+1 404 555 0199' },
    quotes: ['Peachtree Van Lines', 'Windy City Haulers', 'Lone Star Relocation'],
    replied: ['Peachtree Van Lines', 'Windy City Haulers'],
    notes: 'Won by Peachtree Van Lines at $7,900 incl. piano. Customer wants a Saturday pickup.',
  },
  {
    home: 'smallOffice',
    from: '233 S Wacker Dr, Chicago, IL 60606',
    to: '401 N Michigan Ave, Chicago, IL 60611',
    date: '2026-11-28',
    miles: 2,
    floors: [18, 9],
    elevators: [true, true],
    status: 'lost',
    contact: { name: 'Dana Whitfield (Office manager)', email: 'dana@brightpath.example', phone: '' },
    quotes: ['Windy City Haulers'],
    replied: [],
    notes: 'Lost: went with a building-approved vendor. Keep for the next lease move.',
  },
  {
    home: 'oneBed',
    from: '901 E 7th St, Austin, TX 78702',
    to: '1800 Heights Blvd, Houston, TX 77008',
    date: '2026-12-27',
    miles: 165,
    floors: [1, 1],
    elevators: [false, false],
    status: 'quoted',
    contact: { name: 'Jonah Reyes', email: 'jonah.reyes@example.com', phone: '+1 737 555 0160' },
    quotes: ['Lone Star Relocation'],
    replied: [],
  },
  {
    home: 'twoBedFamily',
    from: '19 Walnut St, Somerville, MA 02143',
    to: '240 Elm St, Providence, RI 02906',
    date: '2027-01-16',
    miles: 52,
    floors: [2, 2],
    elevators: [false, false],
    status: 'new',
  },
  {
    home: 'studio',
    from: '1550 Mission St, San Francisco, CA 94103',
    to: '2000 Broadway, Oakland, CA 94612',
    date: '2026-12-02',
    miles: 11,
    floors: [6, 3],
    elevators: [true, true],
    status: 'contacted',
    contact: { name: 'Sam Oduya', email: 'sam.oduya@example.com', phone: '' },
  },
  {
    home: 'threeBedHouse',
    from: '6040 N Central Ave, Phoenix, AZ 85012',
    to: '3300 E Speedway Blvd, Tucson, AZ 85716',
    date: '2027-02-06',
    miles: 115,
    floors: [1, 1],
    elevators: [false, false],
    status: 'new',
    notes: 'Asked for weekend availability; piano confirmed by phone.',
  },
  {
    home: 'oneBed',
    sample: true,
    from: '123 Main St, Austin, TX 78701',
    to: '456 Oak Ave, Dallas, TX 75201',
    date: '2027-01-15',
    miles: 120,
    floors: [3, 1],
    elevators: [false, true],
    status: 'won',
    contact: { name: 'Sample Customer', email: 'sample@example.com', phone: '' },
    quotes: ['Lone Star Relocation', 'Bay State Relocation'],
    replied: ['Lone Star Relocation'],
    notes: 'Sample move used for the demo walkthrough.',
  },
]

// ---------------------------------------------------------------------------
// Building the payloads
// ---------------------------------------------------------------------------

function analysisFor(home) {
  const preset = HOMES[home]
  return {
    items: preset.items.map(([type, count]) => ({ type, count })),
    totalVolumeCubicFeet: preset.volume,
    estimatedBoxes: { min: preset.boxes[0], max: preset.boxes[1] },
    boxesExplanation: preset.note,
    specialHandling: preset.special,
    possibleDuplicates: preset.duplicates,
    unseenAreas: preset.unseen,
  }
}

/** Deterministic price with the same shape the pricing route returns. */
function priceFor(lead, analysis) {
  const boxes = Math.round((analysis.estimatedBoxes.min + analysis.estimatedBoxes.max) / 2)
  const furniture = analysis.items.filter((i) => !/moving box/i.test(i.type)).reduce((n, i) => n + i.count, 0)
  const breakdown = {
    'Packing materials': boxes * 5,
    Labor: furniture * 28 + boxes * 6,
    Transport: Math.max(180, Math.round(lead.miles * 2.4)),
  }
  const stairsFloors =
    (lead.elevators[0] ? 0 : Math.max(0, lead.floors[0] - 1)) +
    (lead.elevators[1] ? 0 : Math.max(0, lead.floors[1] - 1))
  if (stairsFloors > 0) breakdown['Stairs surcharge'] = stairsFloors * 65
  for (const entry of analysis.specialHandling)
    breakdown[`Special handling: ${entry.item}`] = /piano/i.test(entry.item) ? 450 : 120
  const total = Object.values(breakdown).reduce((a, b) => a + b, 0)
  return {
    currency: 'USD',
    total,
    low: Math.round(total * 0.85),
    high: Math.round(total * 1.3),
    breakdown,
    explanation: `${boxes} boxes, ${furniture} furniture pieces and ${lead.miles} miles; ${analysis.specialHandling.length} special-handling items.`,
    confidence: lead.miles > 500 ? 'medium' : 'high',
  }
}

function moveDetailsFor(lead) {
  return {
    from: lead.from,
    to: lead.to,
    date: lead.date,
    distanceMiles: lead.miles,
    originFloor: lead.floors[0],
    destinationFloor: lead.floors[1],
    originElevator: lead.elevators[0],
    destinationElevator: lead.elevators[1],
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

async function call(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`)
  return json
}

async function main() {
  console.log(`Seeding ${BASE_URL}`)
  const status = await call('GET', '/api/admin/status')
  console.log(`admin reachable: env=${status.env} storage=${status.storage}`)

  // movers: match by email, never duplicate
  const existing = (await call('GET', '/api/admin/movers')).movers
  const byEmail = new Map(existing.map((m) => [m.email.toLowerCase(), m]))
  const moversByName = new Map()
  let createdMovers = 0
  for (const mover of MOVERS) {
    const found = byEmail.get(mover.email.toLowerCase())
    if (found) {
      moversByName.set(mover.name, found)
      continue
    }
    const { mover: created } = await call('POST', '/api/admin/movers', { status: 'active', ...mover })
    moversByName.set(mover.name, created)
    createdMovers += 1
  }
  console.log(`movers: ${createdMovers} created, ${MOVERS.length - createdMovers} already there`)

  // leads: refuse to pile up seed leads unless asked
  const leads = (await call('GET', '/api/admin/leads')).leads
  const seeded = leads.filter((l) => typeof l.notes === 'string' && l.notes.startsWith(SEED_TAG))
  if (seeded.length > 0 && !FORCE) {
    console.log(`leads: ${seeded.length} seed leads already exist; pass --force to add another set`)
    console.log('SEED OK (nothing added)')
    return
  }

  let createdLeads = 0
  let createdQuotes = 0
  for (const lead of LEADS) {
    const analysis = analysisFor(lead.home)
    const price = priceFor(lead, analysis)
    const { id } = await call('POST', '/api/estimates', {
      source: lead.sample ? 'sample' : 'own',
      moveDetails: moveDetailsFor(lead),
      analysis,
      items: analysis.items,
      price,
      photoKeys: [],
    })
    createdLeads += 1

    if (lead.contact) {
      await call('PATCH', `/api/estimates/${id}/contact`, { ...lead.contact, requestedDate: lead.date })
    }

    if (lead.quotes?.length) {
      const moverIds = lead.quotes.map((name) => moversByName.get(name)?.id).filter(Boolean)
      const { requests } = await call('POST', '/api/quote-requests', {
        estimateId: id,
        moverIds,
        note: `Please quote this ${lead.home.replace(/([A-Z])/g, ' $1').toLowerCase()} move for ${lead.date}.`,
      })
      createdQuotes += requests.length
      for (const request of requests) {
        if (lead.replied?.includes(request.moverName)) {
          await call('PATCH', `/api/admin/quote-requests/${request.id}`, { status: 'replied' })
        }
      }
    }

    // final status and the seed tag; the API only moves new -> contacted -> quoted on its own
    const notes = `${SEED_TAG} ${lead.notes ?? `${lead.home} move, ${lead.miles} mi`}`
    const update = { notes }
    if (lead.status === 'won' || lead.status === 'lost') update.status = lead.status
    await call('PATCH', `/api/admin/leads/${id}`, update)
    console.log(
      `lead ${id} ${lead.status.padEnd(9)} ${lead.from.split(',')[1]?.trim() ?? ''} -> ${lead.to.split(',')[1]?.trim() ?? ''} $${price.low} to $${price.high}`,
    )
  }

  console.log(`leads: ${createdLeads} created, quote requests: ${createdQuotes}`)
  console.log('SEED OK')
}

main().catch((error) => {
  console.error('SEED FAILED:', error instanceof Error ? error.message : error)
  process.exit(1)
})
