import { vi } from 'vitest'

// Mock WebSocket for tests
global.WebSocket = vi.fn(() => ({
  close: vi.fn(),
  send: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  readyState: 1,
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3
})) as any

// Mock window.location for tests
Object.defineProperty(window, 'location', {
  value: {
    hostname: 'localhost',
    protocol: 'http:',
    port: '5180'
  },
  writable: true
})

// Helper to get current mode from environment
export function getTestMode(): 'turn' | 'simul' {
  return (import.meta.env.VITE_MATCH_MODE || 'turn') as 'turn' | 'simul'
}

// Helper to skip tests based on mode
export function skipIfNotMode(expectedMode: 'turn' | 'simul', testName: string) {
  const currentMode = getTestMode()
  if (currentMode !== expectedMode) {
    console.log(`Skipping ${testName} (mode: ${currentMode}, expected: ${expectedMode})`)
    return true
  }
  return false
}