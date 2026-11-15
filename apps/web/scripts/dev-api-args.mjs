// A Gateway token does not rule out a saved binding role; only explicit offline mock skips binding startup.
export function devApiLaunch(config, staticDir, port, withBinding = config.aiMode?.toLowerCase() !== 'mock') {
  const args = ['pages', 'dev', staticDir, '--ip', '127.0.0.1', '--port', port]
  if (config.shellMode) args.push('--binding', `AI_MODE=${config.shellMode}`)
  if (withBinding) args.push('--ai', 'AI')
  return { args, withBinding }
}
