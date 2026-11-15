#!/usr/bin/env node
/**
 * Starts the estimator API (`wrangler pages dev`) on the fixed port 4611. Vite on 4610 is the entry point and proxies
 * /api here (see vite.config.ts). Wrangler is given a placeholder static directory rather than dist/, because with
 * `pages_build_output_dir` set it would otherwise serve a stale production build (and ignore `--proxy`).
 *
 * Why this is a script and not a plain `wrangler pages dev ...`: a Workers AI binding is always remote, and Wrangler
 * refuses to start at all when it cannot open the remote session (not logged in, offline, several accounts and none
 * chosen). So the binding is not declared in wrangler.toml. This script adds it with `--ai AI` only when it can be
 * used, and when Wrangler fails to come up with it, restarts without it. Unsaved local calls retain the
 * Gateway/offline-mock behavior; saved binding roles report unavailable.
 *
 * Binding is skipped only for AI_MODE=mock; a Gateway token can coexist with saved binding roles.
 * `AI_MODE` is read from the shell first, then `.dev.vars` (the shell value is passed to the worker).
 *
 * Plain Node 22+, no dependencies.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { devApiLaunch } from './dev-api-args.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const WRANGLER = join(ROOT, 'node_modules', '.bin', 'wrangler')
const PORT = '4611'
const STATIC_DIR = join(ROOT, 'scripts', 'dev-static')
/** If Wrangler exits non-zero before it is ready within this window, treat it as "binding unavailable". */
const STARTUP_WINDOW_MS = 45_000

function readDevVars() {
  const file = join(ROOT, '.dev.vars')
  if (!existsSync(file)) return {}
  const vars = {}
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (match && !line.trimStart().startsWith('#')) vars[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
  return vars
}

const devVars = readDevVars()
const setting = (name) => (process.env[name] ?? devVars[name] ?? '').trim()

const launchConfig = { aiMode: setting('AI_MODE').toLowerCase(), shellMode: process.env.AI_MODE }
const wantsBinding = devApiLaunch(launchConfig, STATIC_DIR, PORT).withBinding

/** Applies ./migrations to the local D1 database so the API can save estimates, movers and quote requests. */
function applyMigrations() {
  console.log('[dev-api] applying D1 migrations to the local database (MOVERS_DB)')
  const result = spawnSync(WRANGLER, ['d1', 'migrations', 'apply', 'MOVERS_DB', '--local'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  })
  if (result.status !== 0) {
    console.warn('[dev-api] could not apply D1 migrations; saving estimates will fail until they are applied')
  }
}

applyMigrations()

let child = null
let stopping = false

function start(withBinding) {
  // The D1 binding comes from wrangler.toml; passing --d1 here would create a second, empty database.
  const { args } = devApiLaunch(launchConfig, STATIC_DIR, PORT, withBinding)

  console.log(
    withBinding
      ? '[dev-api] starting with the Workers AI binding (uses your `wrangler login` session; usage is billed to that account)'
      : '[dev-api] starting without the Workers AI binding: AI answers come from the gateway if a token is set, else from the offline mock',
  )

  const startedAt = Date.now()
  let ready = false
  child = spawn(WRANGLER, args, { cwd: ROOT, stdio: ['inherit', 'pipe', 'pipe'], env: process.env })

  const forward = (stream, sink) =>
    stream.on('data', (chunk) => {
      const text = chunk.toString()
      if (/Ready on/i.test(text)) ready = true
      sink.write(chunk)
    })
  forward(child.stdout, process.stdout)
  forward(child.stderr, process.stderr)

  child.on('exit', (code, signal) => {
    if (stopping) return process.exit(code ?? 0)
    const earlyFailure = withBinding && !ready && code !== 0 && Date.now() - startedAt < STARTUP_WINDOW_MS
    if (earlyFailure) {
      console.warn(
        '\n[dev-api] Wrangler exited early while starting with the Workers AI binding (usually: not logged in, offline, or no account chosen; check the output above for the real reason).\n' +
          '[dev-api] Restarting without it: unsaved local AI may use the Gateway or offline mock; saved binding roles will report unavailable.\n' +
          '[dev-api] To enable binding roles: run `wrangler login` (set CLOUDFLARE_ACCOUNT_ID if you have several accounts).\n',
      )
      return start(false)
    }
    process.exit(code ?? (signal ? 1 : 0))
  })
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopping = true
    child?.kill(signal)
  })
}

start(wantsBinding)
