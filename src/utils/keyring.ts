import { Entry } from '@napi-rs/keyring'

const SERVICE = 'mysubs'

export function getKey(name: string): string | null {
  const password = new Entry(SERVICE, name).getPassword()
  if (password == null) return null
  if (password === '') return null
  return password
}

export function setKey(name: string, secret: string): void {
  new Entry(SERVICE, name).setPassword(secret)
}
