import { Entry } from '@napi-rs/keyring'

const KEYRING_SERVICE_NAME = 'mysubs'

export function getKeyringEntrySecret(entryName: string): string | null {
  const password = new Entry(KEYRING_SERVICE_NAME, entryName).getPassword()
  if (password == null) return null
  if (password === '') return null
  return password
}

export function setKeyringEntrySecret(entryName: string, secret: string): void {
  new Entry(KEYRING_SERVICE_NAME, entryName).setPassword(secret)
}
