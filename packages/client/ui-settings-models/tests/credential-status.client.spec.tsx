// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ModelsSettingsState, ModelsSettingsStore } from '../src/client/store.ts'
import { CredentialStatus } from '../src/client/CredentialStatus.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const missing: ModelsSettingsState = {
  status: 'ready',
  error: null,
  credentialError: null,
  writable: true,
  rows: [{
    entry: {
      provider: 'deepseek-official',
      displayName: 'DeepSeek',
      active: true,
      settingsNs: 'llm-deepseek',
      settingsPath: [],
    },
    configured: true,
    removable: false,
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    credential: { configured: false, writable: true },
  }],
  namespaces: new Map(),
}

function t(key: keyof typeof en): string {
  return en[key]
}

describe('CredentialStatus', () => {
  it('keeps a missing credential visible and opens the Models section', () => {
    const openSettings = vi.fn()
    window.addEventListener('dsh-desktop-open-settings', openSettings)
    const controller = {
      store: { getSnapshot: () => missing },
      load: vi.fn(),
    } as unknown as ModelsSettingsStore
    render(<CredentialStatus
      wide
      controller={controller}
      useSnapshot={selector => selector(missing)}
      t={t}
    />)
    const button = screen.getByRole('button', { name: 'Configure API key' })
    expect(button.textContent).toContain('API key required')
    fireEvent.click(button)
    expect((openSettings.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ section: 'models' })
    window.removeEventListener('dsh-desktop-open-settings', openSettings)
  })

  it('loads the shared models state once from idle and stays hidden meanwhile', () => {
    const idle: ModelsSettingsState = { ...missing, status: 'idle', rows: [] }
    const load = vi.fn(() => Promise.resolve())
    const controller = {
      store: { getSnapshot: () => idle },
      load,
    } as unknown as ModelsSettingsStore
    const view = render(<CredentialStatus
      wide={false}
      controller={controller}
      useSnapshot={selector => selector(idle)}
      t={t}
    />)
    expect(view.container.innerHTML).toBe('')
    expect(load).toHaveBeenCalledOnce()
  })
})
