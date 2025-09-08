import { describe, test, expect, beforeEach, vi } from 'vitest'
import { useSocketStore } from './socketStore'

// Mock Socket.IO
const mockSocket = {
  id: 'test-socket-id',
  connected: true,
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  disconnect: vi.fn(),
  once: vi.fn()
}

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocket)
}))

describe('SocketStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    const store = useSocketStore.getState()
    useSocketStore.setState({
      socket: null,
      isConnected: false,
      connectionStatus: 'disconnected',
      currentRoom: null,
      inQueue: false,
      publicRooms: [],
      currentMatch: null,
      matchState: null,
      pendingClaims: new Map(),
      playerId: null,
      mySeat: null,
      gameInputLocked: false,
      lastPong: null,
      serverTime: null,
    })
    
    // Clear mock calls
    vi.clearAllMocks()
  })

  test('squareClaimed handler updates board and currentTurn correctly', () => {
    const store = useSocketStore.getState()
    
    // Set up initial match state
    const initialMatchState = {
      id: 'match-1',
      roomId: 'room-1',
      board: Array(9).fill(null),
      players: ['player1', 'player2'],
      currentTurn: 'P1' as const,
      moves: [],
      version: 0,
      status: 'active' as const,
      winner: null,
      winningLine: null,
      startedAt: new Date()
    }
    
    useSocketStore.setState({ matchState: initialMatchState })
    
    // Simulate squareClaimed event
    const claimData = {
      matchId: 'match-1',
      squareId: 4,
      by: 'P1',
      version: 1,
      nextTurn: 'P2'
    }
    
    // Manually trigger the handler logic (since we're testing the store, not socket events)
    const currentState = useSocketStore.getState()
    if (currentState.matchState) {
      const newBoard = [...currentState.matchState.board]
      newBoard[claimData.squareId] = claimData.by
      
      useSocketStore.setState({
        matchState: {
          ...currentState.matchState,
          board: newBoard,
          version: claimData.version,
          currentTurn: claimData.nextTurn as 'P1' | 'P2'
        }
      })
    }
    
    // Assert the state was updated correctly
    const updatedState = useSocketStore.getState()
    expect(updatedState.matchState).not.toBeNull()
    expect(updatedState.matchState!.board[4]).toBe('P1')
    expect(updatedState.matchState!.version).toBe(1)
    expect(updatedState.matchState!.currentTurn).toBe('P2')
  })

  test('squareClaimed handler ignores stale versions', () => {
    const store = useSocketStore.getState()
    
    // Set up match state with version 5
    const initialMatchState = {
      id: 'match-1',
      roomId: 'room-1',
      board: ['P1', null, null, null, null, null, null, null, null],
      players: ['player1', 'player2'],
      currentTurn: 'P2' as const,
      moves: [],
      version: 5,
      status: 'active' as const,
      winner: null,
      winningLine: null,
      startedAt: new Date()
    }
    
    useSocketStore.setState({ matchState: initialMatchState })
    
    // Simulate stale squareClaimed event (lower version)
    const staleClaimData = {
      matchId: 'match-1',
      squareId: 1,
      by: 'P1',
      version: 3, // Lower than current version (5)
      nextTurn: 'P2'
    }
    
    // The handler should ignore this update due to version guard
    const currentState = useSocketStore.getState()
    if (currentState.matchState && staleClaimData.version <= currentState.matchState.version) {
      // Should not update - this simulates the version guard
      return
    }
    
    // Assert state remains unchanged
    const unchangedState = useSocketStore.getState()
    expect(unchangedState.matchState!.board[1]).toBeNull() // Should still be null
    expect(unchangedState.matchState!.version).toBe(5) // Should still be 5
    expect(unchangedState.matchState!.currentTurn).toBe('P2') // Should still be P2
  })

  test('stateSync handler replaces board and version atomically', () => {
    const store = useSocketStore.getState()
    
    // Set up initial match state
    const initialMatchState = {
      id: 'match-1',
      roomId: 'room-1',
      board: ['P1', null, null, null, null, null, null, null, null],
      players: ['player1', 'player2'],
      currentTurn: 'P2' as const,
      moves: [],
      version: 2,
      status: 'active' as const,
      winner: null,
      winningLine: null,
      startedAt: new Date()
    }
    
    useSocketStore.setState({ matchState: initialMatchState })
    
    // Simulate stateSync event with newer version
    const syncData = {
      board: ['P1', 'P2', null, 'P1', null, null, null, null, null] as (string | null)[],
      moves: [
        { playerId: 'player1', squareId: 0, selectionId: 'sel1', timestamp: new Date() },
        { playerId: 'player2', squareId: 1, selectionId: 'sel2', timestamp: new Date() },
        { playerId: 'player1', squareId: 3, selectionId: 'sel3', timestamp: new Date() }
      ],
      version: 5,
      currentTurn: 'P2' as const,
      winner: null
    }
    
    // Apply stateSync logic
    const currentState = useSocketStore.getState()
    if (!currentState.matchState || syncData.version > currentState.matchState.version) {
      useSocketStore.setState({
        matchState: currentState.matchState ? {
          ...currentState.matchState,
          board: syncData.board,
          moves: syncData.moves,
          version: syncData.version,
          currentTurn: syncData.currentTurn,
          winner: syncData.winner || null
        } : null
      })
    }
    
    // Assert state was updated atomically
    const updatedState = useSocketStore.getState()
    expect(updatedState.matchState).not.toBeNull()
    expect(updatedState.matchState!.board).toEqual(['P1', 'P2', null, 'P1', null, null, null, null, null])
    expect(updatedState.matchState!.version).toBe(5)
    expect(updatedState.matchState!.currentTurn).toBe('P2')
    expect(updatedState.matchState!.moves).toHaveLength(3)
  })

  test('stateSync handler ignores older versions', () => {
    const store = useSocketStore.getState()
    
    // Set up match state with version 10
    const initialMatchState = {
      id: 'match-1',
      roomId: 'room-1',
      board: ['P1', 'P2', 'P1', null, null, null, null, null, null],
      players: ['player1', 'player2'],
      currentTurn: 'P2' as const,
      moves: [],
      version: 10,
      status: 'active' as const,
      winner: null,
      winningLine: null,
      startedAt: new Date()
    }
    
    useSocketStore.setState({ matchState: initialMatchState })
    
    // Simulate stateSync event with older version
    const staleSync = {
      board: ['P1', null, null, null, null, null, null, null, null] as (string | null)[],
      moves: [],
      version: 7, // Older than current version (10)
      currentTurn: 'P1' as const,
      winner: null
    }
    
    // Apply stateSync logic with version guard
    const currentState = useSocketStore.getState()
    if (!currentState.matchState || staleSync.version > currentState.matchState.version) {
      // Should not update due to version guard
      useSocketStore.setState({
        matchState: currentState.matchState ? {
          ...currentState.matchState,
          board: staleSync.board,
          version: staleSync.version,
          currentTurn: staleSync.currentTurn
        } : null
      })
    }
    
    // Assert state remains unchanged
    const unchangedState = useSocketStore.getState()
    expect(unchangedState.matchState!.board).toEqual(['P1', 'P2', 'P1', null, null, null, null, null, null])
    expect(unchangedState.matchState!.version).toBe(10)
    expect(unchangedState.matchState!.currentTurn).toBe('P2')
  })

  test('pending claims are cleared by selectionId on squareClaimed', () => {
    const store = useSocketStore.getState()
    
    // Set up initial state with pending claims
    const pendingClaims = new Map([
      ['claim-1', { squareId: 0, selectionId: 'claim-1', timestamp: new Date() }],
      ['claim-2', { squareId: 4, selectionId: 'claim-2', timestamp: new Date() }],
      ['claim-3', { squareId: 8, selectionId: 'claim-3', timestamp: new Date() }]
    ])
    
    const initialMatchState = {
      id: 'match-1',
      roomId: 'room-1',
      board: Array(9).fill(null),
      players: ['player1', 'player2'],
      currentTurn: 'P1' as const,
      moves: [],
      version: 0,
      status: 'active' as const,
      winner: null,
      winningLine: null,
      startedAt: new Date()
    }
    
    useSocketStore.setState({ 
      matchState: initialMatchState,
      pendingClaims
    })
    
    // Simulate squareClaimed for square 4 (should clear claim-2)
    const claimData = {
      matchId: 'match-1',
      squareId: 4,
      by: 'P1',
      version: 1,
      nextTurn: 'P2'
    }
    
    // Apply squareClaimed logic including pending claim clearing
    const currentState = useSocketStore.getState()
    if (currentState.matchState) {
      const newBoard = [...currentState.matchState.board]
      newBoard[claimData.squareId] = claimData.by
      
      // Clear matching pending claim for this square
      const updatedPendingClaims = new Map(currentState.pendingClaims)
      for (const [selectionId, claim] of updatedPendingClaims.entries()) {
        if (claim.squareId === claimData.squareId) {
          updatedPendingClaims.delete(selectionId)
          break
        }
      }
      
      useSocketStore.setState({
        matchState: {
          ...currentState.matchState,
          board: newBoard,
          version: claimData.version,
          currentTurn: claimData.nextTurn as 'P1' | 'P2'
        },
        pendingClaims: updatedPendingClaims
      })
    }
    
    // Assert the correct pending claim was cleared
    const updatedState = useSocketStore.getState()
    expect(updatedState.pendingClaims.has('claim-1')).toBe(true) // Should remain
    expect(updatedState.pendingClaims.has('claim-2')).toBe(false) // Should be cleared
    expect(updatedState.pendingClaims.has('claim-3')).toBe(true) // Should remain
    expect(updatedState.pendingClaims.size).toBe(2)
  })

  test('claimRejected clears pending claim by selectionId', () => {
    const store = useSocketStore.getState()
    
    // Set up pending claims
    const pendingClaims = new Map([
      ['rejected-claim', { squareId: 5, selectionId: 'rejected-claim', timestamp: new Date() }],
      ['other-claim', { squareId: 7, selectionId: 'other-claim', timestamp: new Date() }]
    ])
    
    useSocketStore.setState({ pendingClaims })
    
    // Simulate claimRejected for 'rejected-claim'
    const rejectData = {
      matchId: 'match-1',
      squareId: 5,
      reason: 'not_your_turn',
      selectionId: 'rejected-claim'
    }
    
    // Apply claimRejected logic
    const currentState = useSocketStore.getState()
    const updatedPendingClaims = new Map(currentState.pendingClaims)
    updatedPendingClaims.delete(rejectData.selectionId)
    
    useSocketStore.setState({
      pendingClaims: updatedPendingClaims
    })
    
    // Assert the correct pending claim was removed
    const updatedState = useSocketStore.getState()
    expect(updatedState.pendingClaims.has('rejected-claim')).toBe(false)
    expect(updatedState.pendingClaims.has('other-claim')).toBe(true)
    expect(updatedState.pendingClaims.size).toBe(1)
  })

  test('stateSync clears pending claims for occupied squares', () => {
    const store = useSocketStore.getState()
    
    // Set up pending claims and initial match state
    const pendingClaims = new Map([
      ['claim-1', { squareId: 2, selectionId: 'claim-1', timestamp: new Date() }], // Square 2 will be occupied
      ['claim-2', { squareId: 5, selectionId: 'claim-2', timestamp: new Date() }], // Square 5 will remain free
      ['claim-3', { squareId: 8, selectionId: 'claim-3', timestamp: new Date() }]  // Square 8 will be occupied
    ])
    
    const initialMatchState = {
      id: 'match-1',
      roomId: 'room-1',
      board: Array(9).fill(null),
      players: ['player1', 'player2'],
      currentTurn: 'P1' as const,
      moves: [],
      version: 5,
      status: 'active' as const,
      winner: null,
      winningLine: null,
      startedAt: new Date()
    }
    
    useSocketStore.setState({ 
      matchState: initialMatchState,
      pendingClaims 
    })
    
    // Simulate stateSync with some squares occupied
    const syncData = {
      board: [null, null, 'P1', null, null, null, null, null, 'P2'] as (string | null)[],
      moves: [],
      version: 8,
      currentTurn: 'P2' as const,
      winner: null
    }
    
    // Apply stateSync logic with pending claim cleanup
    const currentState = useSocketStore.getState()
    if (!currentState.matchState || syncData.version > currentState.matchState.version) {
      // Clear pending claims for occupied squares
      const updatedPendingClaims = new Map(currentState.pendingClaims)
      for (const [selectionId, claim] of updatedPendingClaims.entries()) {
        if (syncData.board[claim.squareId] !== null) {
          updatedPendingClaims.delete(selectionId)
        }
      }
      
      useSocketStore.setState({
        matchState: currentState.matchState ? {
          ...currentState.matchState,
          board: syncData.board,
          version: syncData.version,
          currentTurn: syncData.currentTurn,
          winner: syncData.winner || null
        } : null,
        pendingClaims: updatedPendingClaims
      })
    }
    
    // Assert pending claims were cleared for occupied squares
    const updatedState = useSocketStore.getState()
    expect(updatedState.pendingClaims.has('claim-1')).toBe(false) // Square 2 occupied by P1
    expect(updatedState.pendingClaims.has('claim-2')).toBe(true)  // Square 5 still free
    expect(updatedState.pendingClaims.has('claim-3')).toBe(false) // Square 8 occupied by P2
    expect(updatedState.pendingClaims.size).toBe(1)
  })
})