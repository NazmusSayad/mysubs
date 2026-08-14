import os from 'node:os'
import path from 'node:path'

export function expandHome(target: string): string {
  if (target === '~') return os.homedir()
  if (target.startsWith('~/')) return path.join(os.homedir(), target.slice(2))
  return target
}
