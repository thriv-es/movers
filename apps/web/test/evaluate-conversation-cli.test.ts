// @vitest-environment node
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

function cli(args: string[]) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL('../scripts/evaluate-conversation.mjs', import.meta.url)), ...args],
      { env: { PATH: process.env.PATH, NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (data) => {
      stdout += data
    })
    child.stderr.on('data', (data) => {
      stderr += data
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}
it('CLI without opt-in reports skipped/unavailable, not pass, without any runtime/provider startup', async () => {
  const result = await cli([])
  expect(result.code).toBe(2)
  expect(JSON.parse(result.stdout)).toMatchObject({ pass: false, cases: [] })
  expect(result.stderr).toBe('')
})
it('CLI loads real domain modules and reaches only the synthetic loopback conversation fixture, then refuses mock', async () => {
  const requests: { path?: string; method?: string; snapshot: any }[] = []
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    requests.push({ path: request.url, method: request.method, snapshot: JSON.parse(body).snapshot })
    response.writeHead(200, { 'Content-Type': 'application/json', 'x-movers-ai-mode': 'mock' })
    response.end('{}')
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Fixture unavailable')
    const result = await cli(['--live', '--base-url', `http://127.0.0.1:${address.port}`, '--case', 'freeform'])
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      path: '/api/conversation',
      method: 'POST',
      snapshot: { version: 6, revision: 0 },
    })
    expect(result.code).toBe(1)
    expect(JSON.parse(result.stdout)).toMatchObject({
      pass: false,
      cases: [{ caseId: 'freeform', pass: false, backend: 'unavailable' }],
    })
    expect(result.stderr).toBe('')
  } finally {
    await new Promise<void>((done, fail) => server.close((error) => (error ? fail(error) : done())))
  }
}, 15000)
