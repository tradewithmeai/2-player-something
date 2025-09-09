import { create } from 'zustand'
import { io, Socket } from 'socket.io-client'

// Room types (matching server types)
export type RoomStatus = 'waiting' | 'active' | 'finished'

export interface Player {
  id: string
  joinedAt: Date
  isReady: boolean
}

export interface Room {
  id: string
  code: string
  status: RoomStatus
  players: Player[]
  maxPlayers: number
  createdAt: Date
  lastActivity: Date
  matchStartedAt?: Date
  isPublic: boolean
}

export interface Match {
  roomId: string
  players: Player[]
  startedAt: Date
}

// Match-specific types
export interface MatchState {
  id: string
  roomId: string
  board: (string | null)[]
  players: string[]
  currentTurn: string
  moves: Move[]
  version: number
  status: 'active' | 'finished'
  winner: 'P1' | 'P2' | 'draw' | null
  winningLine: number[] | null
  startedAt: Date
  finishedAt?: Date
}

export interface Move {
  playerId: string
  squareId: number
  selectionId: string
  timestamp: Date
}

export interface PendingClaim {
  squareId: number
  selectionId: string
  timestamp: Date
}

export interface RoomUpdate {
  room: Room
  type: 'player_joined' | 'player_left' | 'status_changed' | 'match_start'
}

interface SocketState {
  // Connection state
  socket: Socket | null
  isConnected: boolean
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'error'
  handlersAttached: boolean
  
  // Room state
  currentRoom: Room | null
  inQueue: boolean
  publicRooms: Room[]
  currentMatch: Match | null
  
  // Match state
  matchState: MatchState | null
  pendingClaims: Map<string, PendingClaim> // selectionId -> PendingClaim
  playerId: string | null
  mySeat: 'P1' | 'P2' | null // My assigned seat in the current match
  gameInputLocked: boolean
  isFinished: boolean // UI-level finished state
  
  // Rematch state
  rematchPending: boolean
  rematchRequesterSeat: 'P1' | 'P2' | null
  
  // UI feedback
  matchFinishedNotice: string | null // For showing "Round finished" messages
  
  // Simul mode state
  matchMode: 'turn' | 'simul' // UI hint from env
  currentWindowId: number | null
  windowDeadline: number | null // timestamp
  pendingSimulClaims: Map<'P1' | 'P2', { squareId: number; selectionId: string }> // seat -> pending claim
  
  // Legacy testing
  lastPong: string | null
  serverTime: string | null
  
  // Actions
  connect: () => void
  disconnect: () => void
  sendPing: () => void
  quickMatch: () => void
  createRoom: (isPublic?: boolean) => void
  joinRoom: (code: string) => void
  leaveRoom: () => void
  getPublicRooms: () => void
  setPlayerReady: (ready: boolean) => void
  claimSquare: (squareId: number) => void
  requestRematch: () => void
  acceptRematch: () => void
}

const SERVER_URL = import.meta.env.VITE_WS_URL || 'http://localhost:8002'
const NAMESPACE = '/game'

// Store helper functions
export const getMySeat = (state: SocketState): 'P1' | 'P2' | null => {
  return state.mySeat
}

export const getOppSeat = (state: SocketState): 'P1' | 'P2' | null => {
  if (state.mySeat === 'P1') return 'P2'
  if (state.mySeat === 'P2') return 'P1'
  return null
}

export const getSymbol = (seat: 'P1' | 'P2' | null): string => {
  if (seat === 'P1') return 'X'
  if (seat === 'P2') return 'O'
  return '—'
}

export const getPlayerShortId = (state: SocketState, seat: 'P1' | 'P2' | null): string => {
  if (!seat || !state.currentMatch?.players) return '—'
  
  // Find player by seat (looking for seat property if available)
  const player = state.currentMatch.players.find((p: any) => 
    p.seat === seat || 
    // Fallback: if no seat property, use positional logic
    (seat === 'P1' && state.currentMatch?.players.indexOf(p) === 0) ||
    (seat === 'P2' && state.currentMatch?.players.indexOf(p) === 1)
  )
  
  return player?.id?.slice(-6) || '—'
}

// Store instance reference for handler access
let storeInstance: any = null

// Stable handler references for proper cleanup
const onConnect = () => {
  const socket = storeInstance.getState().socket
  console.log('Connected to server:', socket?.id)
  storeInstance.setState({
    isConnected: true,
    connectionStatus: 'connected',
    playerId: socket?.id,
  })
}

const onDisconnect = (reason: string) => {
  console.log('Disconnected from server:', reason)
  storeInstance.setState({
    isConnected: false,
    connectionStatus: 'disconnected',
    handlersAttached: false,
    currentRoom: null,
    inQueue: false,
    currentMatch: null,
    matchState: null,
    pendingClaims: new Map(),
    playerId: null,
    gameInputLocked: false,
  })
}

const onConnectError = (error: Error) => {
  console.error('Connection error:', error)
  storeInstance.setState({
    isConnected: false,
    connectionStatus: 'error',
  })
}

const onWelcome = (data: any) => {
  console.log('Welcome message:', data)
}

const onQuickMatchFound = (room: Room) => {
  console.log('Quick match found:', room)
  storeInstance.setState({ currentRoom: room, inQueue: false })
  
  // Ensure we join the room if needed
  setTimeout(() => {
    const state = storeInstance.getState()
    if (state.currentRoom?.id === room.id && !state.currentMatch) {
      console.log('Ensuring room join for', room.code)
      state.socket.emit('joinRoom', room.code)
    }
  }, 1000)
}

const onRoomUpdate = (update: RoomUpdate) => {
  console.log('Room update received:', update)
  storeInstance.setState({ currentRoom: update.room })
}

const onMatchStart = (data: Match & { matchId?: string; mySeat?: 'P1' | 'P2'; currentTurn?: 'P1' | 'P2'; players?: string[] | { id: string; seat: 'P1' | 'P2' }[] }) => {
  console.log('Match started:', data)
  
  // Initialize/reset match state for new or rematch games  
  if (!data.matchId) {
    console.error('matchStart received without matchId:', data)
    return
  }
  
  // Normalize players array with seat information
  let normalizedPlayers: { id: string; seat: 'P1' | 'P2' }[] = []
  
  if (Array.isArray(data.players)) {
    if (data.players.length > 0 && typeof data.players[0] === 'object' && 'seat' in data.players[0]) {
      // Server already provides players with seat info
      normalizedPlayers = data.players as { id: string; seat: 'P1' | 'P2' }[]
    } else if (typeof data.players[0] === 'string') {
      // Server provides socket IDs without seat, derive seats deterministically (P1 is starter)
      normalizedPlayers = (data.players as string[]).map((id, index) => ({
        id,
        seat: index === 0 ? 'P1' : 'P2' as 'P1' | 'P2'
      }))
    }
  } else if (data.players) {
    // Handle legacy players array format from Match interface
    normalizedPlayers = (data.players as any[]).map((player, index) => ({
      id: player.id,
      seat: index === 0 ? 'P1' : 'P2' as 'P1' | 'P2'
    }))
  }
  
  const newMatchState: MatchState = {
    id: data.matchId,
    roomId: data.roomId,
    board: Array(9).fill(null),
    players: normalizedPlayers.map(p => p.id), // MatchState expects string[]
    currentTurn: data.currentTurn || 'P1',
    moves: [],
    version: 0,
    status: 'active',
    winner: null,
    winningLine: null,
    startedAt: data.startedAt,
    finishedAt: undefined
  }
  
  // Update match with normalized players
  const normalizedMatch: Match = {
    ...data,
    players: normalizedPlayers.map(p => ({ 
      id: p.id, 
      joinedAt: new Date(), 
      isReady: true 
    })) // Convert to Match.Player format
  }
  
  // Reset all game and UI state for fresh match/rematch
  storeInstance.setState({ 
    currentMatch: normalizedMatch,
    mySeat: data.mySeat || null,
    matchState: newMatchState,
    gameInputLocked: false,
    isFinished: false,
    rematchPending: false,
    rematchRequesterSeat: null,
    matchFinishedNotice: null,
    pendingClaims: new Map(),
    pendingSimulClaims: new Map()
  })
  
  // Log structured matchStart event
  console.log(JSON.stringify({
    evt: 'frontend.matchStart',
    matchId: data.matchId,
    mySeat: data.mySeat || null,
    currentTurn: data.currentTurn || 'P1',
    playersWithSeats: normalizedPlayers.length
  }))
  
  // If this is a rematch (new match starting), log rematch started
  if (storeInstance.getState().rematchPending) {
    console.log(JSON.stringify({
      evt: 'frontend.rematch.started',
      matchId: data.matchId
    }))
  }
}

const onSquareClaimed = (data: { matchId: string; squareId: number; by: string; version: number; nextTurn?: string }) => {
  const state = storeInstance.getState()
  
  console.log(`[SquareClaimed] Received:`, {
    matchId: data.matchId,
    squareId: data.squareId,
    by: data.by,
    version: data.version,
    nextTurn: data.nextTurn,
    currentVersion: state.matchState?.version,
    currentMatchId: state.matchState?.id,
    mySeat: state.mySeat
  })
  
  // Validate matchId
  if (state.matchState && data.matchId !== state.matchState.id) {
    console.log(`[SquareClaimed] DROPPED: matchId mismatch. Expected: ${state.matchState.id}, Got: ${data.matchId}`)
    return
  }
  
  // Guard versioning: ignore events with version <= currentVersion
  if (state.matchState && data.version <= state.matchState.version) {
    console.log(`[SquareClaimed] DROPPED: stale version. Event: ${data.version}, Current: ${state.matchState.version}`)
    return
  }
  
  // Update board directly from event data
  if (state.matchState) {
    const newBoard = [...state.matchState.board]
    const oldValue = newBoard[data.squareId]
    newBoard[data.squareId] = data.by
    
    // Clear matching pending claim for this square
    const updatedPendingClaims = new Map(state.pendingClaims)
    let clearedClaim = null
    for (const [selectionId, claim] of updatedPendingClaims.entries()) {
      if ((claim as PendingClaim).squareId === data.squareId) {
        updatedPendingClaims.delete(selectionId)
        clearedClaim = selectionId
        break
      }
    }
    
    const newState = {
      ...state.matchState,
      board: newBoard,
      version: data.version,
      currentTurn: (data.nextTurn as 'P1' | 'P2') || state.matchState.currentTurn
    }
    
    console.log(`[SquareClaimed] APPLIED:`, {
      squareId: data.squareId,
      oldValue,
      newValue: data.by,
      oldVersion: state.matchState.version,
      newVersion: data.version,
      oldTurn: state.matchState.currentTurn,
      newTurn: newState.currentTurn,
      clearedPendingClaim: clearedClaim,
      pendingClaimsRemaining: updatedPendingClaims.size
    })
    
    // Log structured squareClaimed applied event
    console.log(JSON.stringify({
      evt: 'frontend.squareClaimed.applied',
      squareId: data.squareId,
      by: data.by,
      version: data.version,
      nextTurn: newState.currentTurn
    }))
    
    storeInstance.setState({
      matchState: newState,
      pendingClaims: updatedPendingClaims
    })
  } else {
    console.log(`[SquareClaimed] DROPPED: no matchState available`)
  }
}

const onClaimRejected = (data: { matchId: string; squareId: number; reason: string; selectionId: string }) => {
  console.log('Claim rejected:', data)
  const state = storeInstance.getState()
  
  // Remove the rejected pending claim
  const updatedPendingClaims = new Map(state.pendingClaims)
  updatedPendingClaims.delete(data.selectionId)
  
  // For simul mode, also clear pending simul claims if it matches
  const updatedPendingSimulClaims = new Map(state.pendingSimulClaims)
  if (state.mySeat) {
    const myPendingClaim = updatedPendingSimulClaims.get(state.mySeat)
    if (myPendingClaim && myPendingClaim.squareId === data.squareId) {
      updatedPendingSimulClaims.delete(state.mySeat)
    }
  }
  
  storeInstance.setState({
    pendingClaims: updatedPendingClaims,
    pendingSimulClaims: updatedPendingSimulClaims
  })
  
  // Handle different rejection reasons
  if (data.reason === 'already_claimed' || data.reason === 'square_occupied') {
    console.log('Square already taken!')
    // TODO: Add visual flash effect
  } else if (data.reason === 'not_your_turn') {
    console.log('Not your turn!')
  } else if (data.reason === 'conflict_lost') {
    console.log('Claim conflict - lost to opponent!')
    // TODO: Add "taken" flash effect for simul mode
  } else if (data.reason === 'match_finished') {
    console.log('Match finished - no more moves allowed!')
    // Lock the UI immediately and show notice
    storeInstance.setState({
      isFinished: true,
      matchFinishedNotice: 'Round finished — start a rematch'
    })
  }
}

const onStateSync = (data: { board: (string | null)[]; moves: Move[]; version: number; currentTurn: string; winner?: 'P1' | 'P2' | 'draw' | null; winningLine?: number[] | null }) => {
  const state = storeInstance.getState()
  
  console.log(`[StateSync] Received:`, {
    version: data.version,
    currentVersion: state.matchState?.version,
    board: data.board,
    currentTurn: data.currentTurn,
    winner: data.winner,
    moves: data.moves.length
  })
  
  // Only apply if version is newer
  if (!state.matchState) {
    console.log(`[StateSync] DROPPED: no matchState available`)
    return
  }
  
  if (data.version < state.matchState.version) {
    console.log(`[StateSync] DROPPED: stale version. Event: ${data.version}, Current: ${state.matchState.version}`)
    return
  }
  
  // One-time debug log when applying equal version at startup
  if (data.version === state.matchState.version && data.version === 0) {
    console.log(JSON.stringify({
      evt: 'frontend.state.applied.equalVersion',
      version: 0
    }))
  }
  
  // Clear pending claims for occupied squares
  const updatedPendingClaims = new Map(state.pendingClaims)
  const clearedClaims: string[] = []
  
  for (const [selectionId, claim] of updatedPendingClaims.entries()) {
    if (data.board[(claim as PendingClaim).squareId] !== null) {
      updatedPendingClaims.delete(selectionId)
      clearedClaims.push(selectionId as string)
    }
  }
  
  const isMatchFinished = data.winner !== undefined && data.winner !== null
  
  const newState = {
    ...state.matchState,
    board: data.board,
    moves: data.moves,
    version: data.version,
    currentTurn: data.currentTurn as 'P1' | 'P2',
    winner: data.winner || null,
    winningLine: data.winningLine || null,
    status: isMatchFinished ? 'finished' as const : state.matchState.status
  }
  
  // Update UI-level isFinished state when winner is present
  const uiState = isMatchFinished ? {
    matchState: newState,
    pendingClaims: updatedPendingClaims,
    isFinished: true
  } : {
    matchState: newState,
    pendingClaims: updatedPendingClaims
  }
  
  console.log(`[StateSync] APPLIED:`, {
    oldVersion: state.matchState.version,
    newVersion: data.version,
    boardChanges: state.matchState.board.map((old: string | null, i: number) => old !== data.board[i] ? `${i}: ${old} → ${data.board[i]}` : null).filter(Boolean),
    oldTurn: state.matchState.currentTurn,
    newTurn: newState.currentTurn,
    clearedClaims,
    pendingClaimsRemaining: updatedPendingClaims.size
  })
  
  storeInstance.setState(uiState)
}

const onResult = (data: { matchId: string; winner: 'P1' | 'P2' | 'draw' | null; line?: number[] | null; winningLine?: number[] | null }) => {
  console.log('Game result:', data)
  
  // Log frontend.result.received for structured logging
  console.log(JSON.stringify({
    evt: 'frontend.result.received',
    matchId: data.matchId,
    winner: data.winner
  }))
  
  const state = storeInstance.getState()
  const line = data.line || data.winningLine
  
  // Update match state to finished if we have match state
  if (state.matchState && state.matchState.id === data.matchId) {
    const updatedMatchState = {
      ...state.matchState,
      status: 'finished' as const,
      winner: data.winner,
      winningLine: line,
      finishedAt: new Date()
    }
    
    storeInstance.setState({ 
      matchState: updatedMatchState,
      isFinished: true,
      gameInputLocked: true,
      rematchPending: false // Clear any pending rematch state
    })
  } else {
    // Fallback: just lock input and set finished
    storeInstance.setState({ 
      gameInputLocked: true,
      isFinished: true
    })
  }
  
  // Show winner/draw
  console.log(data.winner === 'draw' ? 'Draw!' : data.winner ? `Winner: ${data.winner}` : 'Game Over!', line ? `Winning line: ${line}` : '')
}

const onGameResult = onResult // Legacy compatibility

const onRoomJoined = (room: Room) => {
  console.log('Joined room:', room)
  storeInstance.setState({ currentRoom: room, inQueue: false })
}

const onRoomLeft = () => {
  console.log('Left room')
  storeInstance.setState({ currentRoom: null, inQueue: false })
}

const onPublicRooms = (rooms: Room[]) => {
  console.log('Public rooms received:', rooms)
  storeInstance.setState({ publicRooms: rooms })
}

const onError = (message: string) => {
  console.error('Server error:', message)
  alert(`Error: ${message}`)
}

const onPong = (data: any) => {
  console.log('Received pong:', data)
  storeInstance.setState({
    lastPong: new Date().toISOString(),
    serverTime: data.serverTime,
  })
}

const onRematchPending = (data: { matchId: string; requesterSeat: 'P1' | 'P2' }) => {
  console.log('Rematch pending:', data)
  
  storeInstance.setState({ 
    rematchPending: true, 
    rematchRequesterSeat: data.requesterSeat 
  })
  
  console.log(JSON.stringify({
    evt: 'frontend.rematch.pending',
    requesterSeat: data.requesterSeat
  }))
}

const onRematchTimeout = (data: { matchId: string }) => {
  console.log('Rematch timeout:', data)
  
  storeInstance.setState({ 
    rematchPending: false,
    rematchRequesterSeat: null 
  })
  
  console.log(JSON.stringify({
    evt: 'frontend.rematch.timeout',
    matchId: data.matchId
  }))
}

const onWindowOpen = (data: { matchId: string; windowId: number; starterSeat: 'P1' | 'P2'; deadlineTs: number }) => {
  console.log('Window opened:', data)
  
  storeInstance.setState({
    currentWindowId: data.windowId,
    windowDeadline: data.deadlineTs
  })
  
  console.log(JSON.stringify({
    evt: 'frontend.window.open',
    windowId: data.windowId,
    starterSeat: data.starterSeat,
    deadline: data.deadlineTs
  }))
}

const onWindowClose = (data: { matchId: string; windowId: number; applied: any[]; rejected: any[] }) => {
  console.log('Window closed:', data)
  
  // Clear pending simul claims
  storeInstance.setState({
    currentWindowId: null,
    windowDeadline: null,
    pendingSimulClaims: new Map()
  })
  
  console.log(JSON.stringify({
    evt: 'frontend.window.close',
    windowId: data.windowId,
    applied: data.applied.length,
    rejected: data.rejected.length
  }))
}

const onMatchStateUpdate = (data: { matchId: string; matchState: MatchState; version: number }) => {
  console.log('Match state update:', data)
  const state = storeInstance.getState()
  
  // Guard versioning: only drop if incoming.version < currentVersion
  if (state.matchState && data.version < state.matchState.version) {
    console.log('Ignoring stale version:', data.version, 'current:', state.matchState.version)
    return
  }
  
  // One-time debug log when applying equal version at startup
  if (state.matchState && data.version === state.matchState.version && data.version === 0) {
    console.log(JSON.stringify({
      evt: 'frontend.state.applied.equalVersion',
      version: 0
    }))
  }
  
  // Apply the payload atomically: board, moves, version, currentTurn, winner/winningLine
  const updatedMatchState = {
    ...data.matchState,
    board: data.matchState.board,
    moves: data.matchState.moves,
    version: data.version,
    currentTurn: data.matchState.currentTurn,
    winner: data.matchState.winner || null,
    winningLine: data.matchState.winningLine || null
  }
  
  storeInstance.setState({
    matchState: updatedMatchState
  })
}

// List of all events for handler management
const SOCKET_EVENTS = [
  'connect', 'disconnect', 'connect_error', 'welcome', 'quickMatchFound', 
  'roomUpdate', 'matchStart', 'squareClaimed', 'claimRejected', 'stateSync',
  'matchStateUpdate', 'result', 'gameResult', 'roomJoined', 'roomLeft',
  'publicRooms', 'error', 'pong', 'rematchPending', 'rematchTimeout', 'windowOpen', 'windowClose'
] as const

// Event to handler mapping
const EVENT_HANDLERS = {
  'connect': onConnect,
  'disconnect': onDisconnect,
  'connect_error': onConnectError,
  'welcome': onWelcome,
  'quickMatchFound': onQuickMatchFound,
  'roomUpdate': onRoomUpdate,
  'matchStart': onMatchStart,
  'squareClaimed': onSquareClaimed,
  'claimRejected': onClaimRejected,
  'stateSync': onStateSync,
  'matchStateUpdate': onMatchStateUpdate,
  'result': onResult,
  'gameResult': onGameResult,
  'roomJoined': onRoomJoined,
  'roomLeft': onRoomLeft,
  'publicRooms': onPublicRooms,
  'error': onError,
  'pong': onPong,
  'rematchPending': onRematchPending,
  'rematchTimeout': onRematchTimeout,
  'windowOpen': onWindowOpen,
  'windowClose': onWindowClose
} as const

// Handler management utilities
const detachAllHandlers = (socket: Socket) => {
  if (!socket) return
  
  SOCKET_EVENTS.forEach(event => {
    socket.off(event, EVENT_HANDLERS[event])
  })
  
  console.log(JSON.stringify({
    evt: 'frontend.handlers.detached',
    events: SOCKET_EVENTS
  }))
}

const attachAllHandlers = (socket: Socket) => {
  if (!socket) return
  
  SOCKET_EVENTS.forEach(event => {
    socket.on(event, EVENT_HANDLERS[event])
  })
  
  console.log(JSON.stringify({
    evt: 'frontend.handlers.attached',
    events: SOCKET_EVENTS
  }))
}

export const useSocketStore = create<SocketState>((set, get) => {
  // Store reference for handlers
  storeInstance = { getState: get, setState: set }
  
  return {
  // Initial state
  socket: null,
  isConnected: false,
  connectionStatus: 'disconnected',
  handlersAttached: false,
  currentRoom: null,
  inQueue: false,
  publicRooms: [],
  currentMatch: null,
  matchState: null,
  pendingClaims: new Map(),
  playerId: null,
  mySeat: null,
  gameInputLocked: false,
  isFinished: false,
  rematchPending: false,
  rematchRequesterSeat: null,
  matchFinishedNotice: null,
  matchMode: (import.meta.env.VITE_MATCH_MODE || 'turn') as 'turn' | 'simul',
  currentWindowId: null,
  windowDeadline: null,
  pendingSimulClaims: new Map(),
  lastPong: null,
  serverTime: null,

  connect: () => {
    const { socket: existingSocket, handlersAttached } = get()
    if (existingSocket?.connected) return

    set({ connectionStatus: 'connecting' })

    // Log the effective URL
    console.log(JSON.stringify({
      evt: 'frontend.ws.url',
      url: `${SERVER_URL}${NAMESPACE}`
    }))
    
    const socket = io(`${SERVER_URL}${NAMESPACE}`, {
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
    })

    // Log outgoing events for diagnostics (keep emit wrapper but not on wrapper)
    const originalEmit = socket.emit.bind(socket)
    socket.emit = function(event: string, ...args: any[]) {
      console.log(`[Socket→Server] ${event}:`, args)
      return originalEmit(event, ...args)
    }

    // Single-attach guard: detach existing handlers if already attached
    if (handlersAttached) {
      detachAllHandlers(socket)
    }
    
    // Attach all handlers using stable refs
    attachAllHandlers(socket)

    set({ socket, handlersAttached: true })
  },

  disconnect: () => {
    const { socket } = get()
    if (socket) {
      // Detach all handlers before disconnecting
      detachAllHandlers(socket)
      socket.disconnect()
      set({
        socket: null,
        isConnected: false,
        connectionStatus: 'disconnected',
        handlersAttached: false,
        currentRoom: null,
        inQueue: false,
        publicRooms: [],
        currentMatch: null,
        matchState: null,
        pendingClaims: new Map(),
      })
    }
  },

  // Room actions
  quickMatch: () => {
    const { socket, isConnected } = get()
    if (socket && isConnected) {
      console.log('Requesting quick match')
      socket.emit('quickMatch')
      set({ inQueue: true })
      
      // Set up a watchdog for timeout
      const timeoutId = setTimeout(() => {
        const state = get()
        if (state.inQueue && !state.currentRoom) {
          console.log('Quick match timeout - retrying once')
          // Retry once with jitter
          const jitter = 200 + Math.random() * 200 // 200-400ms
          setTimeout(() => {
            const state = get()
            if (state.inQueue && !state.currentRoom && state.socket?.connected) {
              console.log('Retrying quick match')
              state.socket.emit('quickMatch')
            }
          }, jitter)
        }
      }, 3000)
      
      // Clear timeout if we get a response
      const clearWatchdog = () => {
        clearTimeout(timeoutId)
      }
      
      socket.once('quickMatchFound', clearWatchdog)
      socket.once('roomUpdate', clearWatchdog)
    }
  },

  createRoom: (isPublic = false) => {
    const { socket, isConnected } = get()
    if (socket && isConnected) {
      console.log('Creating room (public:', isPublic, ')')
      socket.emit('createRoom', isPublic)
    }
  },

  joinRoom: (code: string) => {
    const { socket, isConnected } = get()
    if (socket && isConnected) {
      console.log('Joining room:', code)
      socket.emit('joinRoom', code)
    }
  },

  leaveRoom: () => {
    const { socket, isConnected } = get()
    if (socket && isConnected) {
      console.log('Leaving room')
      socket.emit('leaveRoom')
    }
  },

  getPublicRooms: () => {
    const { socket, isConnected } = get()
    if (socket && isConnected) {
      console.log('Getting public rooms')
      socket.emit('getPublicRooms')
    }
  },

  setPlayerReady: (ready: boolean) => {
    const { socket, isConnected } = get()
    if (socket && isConnected) {
      console.log('Setting player ready:', ready)
      socket.emit('playerReady', ready)
    }
  },

  claimSquare: (squareId: number) => {
    const { socket, isConnected, matchState, playerId, isFinished, mySeat, matchMode, pendingSimulClaims } = get()
    
    // No-op guards per requirements
    if (isFinished) {
      console.log('claimSquare no-op: game is finished')
      return
    }
    
    if (!matchState) {
      console.log('claimSquare no-op: no match state')
      return
    }
    
    if (matchState.board[squareId] !== null) {
      console.log('claimSquare no-op: square already occupied')
      return
    }
    
    // Mode-specific checks
    if (matchMode === 'turn') {
      // Turn-based: check if it's player's turn
      if (mySeat !== matchState.currentTurn) {
        console.log('claimSquare no-op: not my turn (turn mode)')
        return
      }
    } else {
      // Simul mode: allow claims anytime but track pending
    }
    
    if (socket && isConnected && matchState && playerId && mySeat) {
      const selectionId = `claim_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      
      if (matchMode === 'simul') {
        // Simul mode: store pending claim per seat
        const updatedPendingSimulClaims = new Map(pendingSimulClaims)
        updatedPendingSimulClaims.set(mySeat, { squareId, selectionId })
        set({ pendingSimulClaims: updatedPendingSimulClaims })
      } else {
        // Turn mode: use legacy pending claims
        const pendingClaim: PendingClaim = {
          squareId,
          selectionId,
          timestamp: new Date()
        }
        
        const updatedPendingClaims = new Map(get().pendingClaims)
        updatedPendingClaims.set(selectionId, pendingClaim)
        set({ pendingClaims: updatedPendingClaims })
      }
      
      // Send claim to server
      socket.emit('claimSquare', {
        matchId: matchState.id,
        squareId,
        selectionId
      })
      
      console.log(`Claiming square ${squareId} with selectionId ${selectionId} (mode: ${matchMode})`)
    }
  },

  requestRematch: () => {
    const { socket, isConnected, matchState } = get()
    if (socket && isConnected && matchState && matchState.status === 'finished') {
      console.log('Requesting rematch for match:', matchState.id)
      socket.emit('rematch', { matchId: matchState.id })
      // Don't set rematchPending here - let the server broadcast handle it
    }
  },

  acceptRematch: () => {
    const { socket, isConnected, matchState } = get()
    if (socket && isConnected && matchState && matchState.status === 'finished') {
      console.log('Accepting rematch for match:', matchState.id)
      socket.emit('rematch', { matchId: matchState.id })
      
      console.log(JSON.stringify({
        evt: 'frontend.rematch.accepted'
      }))
    }
  },

  // Legacy ping
  sendPing: () => {
    const { socket, isConnected } = get()
    if (socket && isConnected) {
      const pingData = {
        clientTime: new Date().toISOString(),
        message: 'ping from client',
      }
      socket.emit('ping', pingData)
      console.log('Sent ping:', pingData)
    }
  },
}
})

// HMR safety: detach handlers on module reload
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    const store = useSocketStore.getState()
    if (store.socket) {
      detachAllHandlers(store.socket)
    }
  })
}
