#!/usr/bin/env node
/**
 * Starts the estimator API (`wrangler pages dev`) on the fixed port 4610, proxying the Vite dev server on 4611.
 *
 * Why this is a script and not a plain `wrangler pages dev ...`: a Workers AI binding is always remote, and Wrangler
 * refuses to start at all when it cannot open the remote session (not logged in, offline, several accounts and none
 * chosen). So the binding is not declared in wrangler.toml. This script adds it with `--ai AI` only when it can be
 * used, and when Wrangler fails to come up with it, restarts without it. The API then answers with the offline mock
 * and labels every response as demo data.
 *
 * Binding is skipped when AI_MODE=mock, or when a real CF_AIG_TOKEN is configured and AI_MODE is not `binding`.
 * Settings are read from the process environment first, then from `.dev.vars`.
 *
 * Plain Node 22+, no dependencies.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const WRANGLER = join(ROOT, 'node_modules', '.bin', 'wrangler')
const PLACEHOLDER_TOKEN = 'your_cloudflare_ai_gateway_token_here'
const PORT = '4610'
const PROXY_PORT = '4611'
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

const aiMode = setting('AI_MODE').toLowerCase()
const token = setting('CF_AIG_TOKEN')
const hasRealToken = token !== '' && token !== PLACEHOLDER_TOKEN

const wantsBinding = aiMode === 'binding' || (aiMode !== 'mock' && aiMode !== 'gateway' && !hasRealToken)

function baseArgs() {
  const args = ['pages', 'dev', '--proxy', PROXY_PORT, '--port', PORT]
  // Wrangler reads .dev.vars itself; only a value that came from the shell needs to be passed on.
  if (process.env.AI_MODE) args.push('--binding', `AI_MODE=${process.env.AI_MODE}`)
  return args
}

let child = null
let stopping = false

function start(withBinding) {
  const args = baseArgs()
  if (withBinding) args.push('--ai', 'AI')

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
        '\n[dev-api] Wrangler could not start with the Workers AI binding (not logged in, offline, or no account chosen).\n' +
          '[dev-api] Restarting without it: AI answers will be the offline mock, shown in the app as "Demo data".\n' +
          '[dev-api] To use real AI: run `wrangler login` (set CLOUDFLARE_ACCOUNT_ID if you have several accounts), or set CF_AIG_TOKEN in .dev.vars.\n',
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
