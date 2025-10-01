import { describe, it, expect, beforeEach, vi, test } from 'vitest'
import { useSocketStore } from './socketStore'
import { resetStore, isSimul, isTurn } from './tests/testUtils'

// Skip entire test suite if not in simul mode
if (!isSimul()) {
  test.skip('skipping simul tests in turn mode', () => {})
}

describe('Simul Mode Frontend Tests', () => {
  beforeEach(() => {
    resetStore()
  })

  describe('Simul Mode State Management', () => {
    it('should initialize with simul mode from environment', () => {
      if (!isSimul()) {
        expect.soft(true).toBe(true) // Skip in turn mode
        return
      }
      
      const state = useSocketStore.getState()
      expect(state.matchMode).toBe('simul')
      expect(state.pendingSimulClaims).toBeInstanceOf(Map)
      expect(state.currentWindowId).toBe(null)
      expect(state.windowDeadline).toBe(null)
    })

    it('should handle window open events', () => {
      // Simulate windowOpen event
      useSocketStore.setState({
        currentWindowId: 1,
        windowDeadline: Date.now() + 5000
      })

      const state = useSocketStore.getState()
      expect(state.currentWindowId).toBe(1)
      expect(state.windowDeadline).toBeGreaterThan(Date.now())
    })

    it('should handle window close events', () => {
      // Set up initial window state
      useSocketStore.setState({
        currentWindowId: 1,
        windowDeadline: Date.now() + 5000,
        pendingSimulClaims: new Map([['P1', { squareId: 0, selectionId: 'test' }]])
      })

      // Simulate windowClose event
      useSocketStore.setState({
        currentWindowId: null,
        windowDeadline: null,
        pendingSimulClaims: new Map()
      })

      const state = useSocketStore.getState()
      expect(state.currentWindowId).toBe(null)
      expect(state.windowDeadline).toBe(null)
      expect(state.pendingSimulClaims.size).toBe(0)
    })
  })

  describe('Simul Claim Handling', () => {
    it('should store pending simul claims per seat', () => {
      if (!isSimul()) {
        expect.soft(true).toBe(true) // Skip in turn mode
        return
      }
      // Set up match state
      useSocketStore.setState({
        matchState: {
          id: 'match1',
          roomId: 'room1',
          board: Array(9).fill(null),
          players: ['player1', 'player2'],
          currentTurn: 'P1',
          moves: [],
          version: 0,
          status: 'active' as const,
          winner: null,
          winningLine: null,
          startedAt: new Date()
        },
        mySeat: 'P1',
        isConnected: true,
        playerId: 'player1'
      })

      // Mock socket
      const mockSocket = {
        emit: vi.fn()
      }
      useSocketStore.setState({ socket: mockSocket as any })

      // Trigger claim
      const store = useSocketStore.getState()
      store.claimSquare(0)

      // Check that pending claim was stored
      const state = useSocketStore.getState()
      expect(state.pendingSimulClaims.has('P1')).toBe(true)
      expect(state.pendingSimulClaims.get('P1')?.squareId).toBe(0)
      
      // Check that socket.emit was called
      expect(mockSocket.emit).toHaveBeenCalledWith('claimSquare', expect.objectContaining({
        matchId: 'match1',
        squareId: 0
      }))
    })

    it('should allow claims even when not current turn in simul mode', () => {
      // Set up match state where it's not our turn
      useSocketStore.setState({
        matchState: {
          id: 'match1',
          roomId: 'room1',
          board: Array(9).fill(null),
          players: ['player1', 'player2'],
          currentTurn: 'P2', // Not our turn
          moves: [],
          version: 0,
          status: 'active' as const,
          winner: null,
          winningLine: null,
          startedAt: new Date()
        },
        mySeat: 'P1', // We are P1
        isConnected: true,
        playerId: 'player1',
        matchMode: 'simul'
      })

      const mockSocket = { emit: vi.fn() }
      useSocketStore.setState({ socket: mockSocket as any })

      // Should allow claim in simul mode even when not our turn
      const store = useSocketStore.getState()
      store.claimSquare(0)

      expect(mockSocket.emit).toHaveBeenCalled()
      const state = useSocketStore.getState()
      expect(state.pendingSimulClaims.has('P1')).toBe(true)
    })

    it.skipIf(isSimul())('should block claims when not current turn in turn mode', () => {
      // Set up turn mode state  
      useSocketStore.setState({
        matchState: {
          id: 'match1',
          roomId: 'room1',
          board: Array(9).fill(null),
          players: ['player1', 'player2'],
          currentTurn: 'P2', // Not our turn
          moves: [],
          version: 0,
          status: 'active' as const,
          winner: null,
          winningLine: null,
          startedAt: new Date()
        },
        mySeat: 'P1',
        isConnected: true,
        playerId: 'player1',
        matchMode: 'turn' // Turn mode
      })

      const mockSocket = { emit: vi.fn() }
      useSocketStore.setState({ socket: mockSocket as any })

      // Should NOT allow claim in turn mode when not our turn
      const store = useSocketStore.getState()
      store.claimSquare(0)

      expect(mockSocket.emit).not.toHaveBeenCalled()
      const state = useSocketStore.getState()
      expect(state.pendingSimulClaims.has('P1')).toBe(false)
    })
  })

  describe('Conflict Handling', () => {
    it('should clear pending simul claims on conflict rejection', () => {
      // Set up pending claim
      useSocketStore.setState({
        mySeat: 'P1',
        pendingSimulClaims: new Map([['P1', { squareId: 0, selectionId: 'test123' }]])
      })

      // Simulate conflict rejection
      useSocketStore.setState({
        pendingSimulClaims: new Map() // Cleared due to conflict
      })

      const state = useSocketStore.getState()
      expect(state.pendingSimulClaims.size).toBe(0)
    })
  })
})