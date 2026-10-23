import { safeStorage } from 'electron'
import { chmodSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { writeAtomic } from './persist'

export type TokenProtection = 'os' | 'basic'

/** The YouTrack token lives outside the database, encrypted with the OS keychain. */
export class TokenStore {
  constructor(private readonly path: string) {}

  /**
   * Linux without Secret Service/KWallet has no keychain. Fall back to Electron's
   * basic obfuscation (file readable by the user only) and tell the user so.
   */
  protection(): TokenProtection {
    if (process.platform === 'linux') {
      if (!safeStorage.isEncryptionAvailable()) safeStorage.setUsePlainTextEncryption(true)
      if (safeStorage.getSelectedStorageBackend() === 'basic_text') return 'basic'
    }
    return 'os'
  }

  has(): boolean {
    return existsSync(this.path)
  }

  get(): string | null {
    if (!this.has()) return null
    try {
      this.protection()
      return safeStorage.decryptString(readFileSync(this.path))
    } catch {
      return null
    }
  }

  set(token: string): void {
    this.protection()
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Keine sichere Ablage für den Token verfügbar')
    writeAtomic(this.path, safeStorage.encryptString(token))
    chmodSync(this.path, 0o600)
  }

  clear(): void {
    rmSync(this.path, { force: true })
  }
}
