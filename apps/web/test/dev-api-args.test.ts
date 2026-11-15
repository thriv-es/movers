// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { devApiLaunch } from '../scripts/dev-api-args.mjs'

describe('local API launcher arguments', () => {
  const staticDir = '/synthetic/static'
  const port = '4611'

  it('tries a binding alongside a Gateway token so saved roles can mix backends', () => {
    const launch = devApiLaunch({ aiMode: '', gatewayToken: 'synthetic-token' }, staticDir, port)
    expect(launch.withBinding).toBe(true)
    expect(launch.args).toEqual(['pages', 'dev', staticDir, '--ip', '127.0.0.1', '--port', port, '--ai', 'AI'])
    expect(JSON.stringify(launch)).not.toContain('synthetic-token')
  })

  it('keeps explicit offline mock binding-free and permits a binding-free retry', () => {
    expect(devApiLaunch({ aiMode: 'mock', shellMode: 'mock' }, staticDir, port).args).toEqual([
      'pages',
      'dev',
      staticDir,
      '--ip',
      '127.0.0.1',
      '--port',
      port,
      '--binding',
      'AI_MODE=mock',
    ])
    const retry = devApiLaunch({ aiMode: '', gatewayToken: 'synthetic-token' }, staticDir, port, false)
    expect(retry.withBinding).toBe(false)
    expect(retry.args).not.toContain('--ai')
  })
})
