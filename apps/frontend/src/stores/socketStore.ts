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
  
  // UI feedback
  matchFinishedNotice: string | null // For showing "Round finished" messages
  
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
}

const SERVER_URL = import.meta.env.VITE_WS_URL || 'http://localhost:8002'
const NAMESPACE = '/game'

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
    matchFinishedNotice: null,
    pendingClaims: new Map()
  })
  
  // Log structured matchStart event
  console.log(JSON.stringify({
    evt: 'frontend.matchStart',
    matchId: data.matchId,
    mySeat: data.mySeat || null,
    currentTurn: data.currentTurn || 'P1',
    playersWithSeats: normalizedPlayers.length
  }))
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
  
  storeInstance.setState({
    pendingClaims: updatedPendingClaims
  })
  
  // Handle different rejection reasons
  if (data.reason === 'already_claimed' || data.reason === 'square_occupied') {
    console.log('Square already taken!')
    // TODO: Add visual flash effect
  } else if (data.reason === 'not_your_turn') {
    console.log('Not your turn!')
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

const onRematchPending = (data: any) => {
  console.log('Rematch pending:', data)
  storeInstance.setState({ rematchPending: true })
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

// Handler management utilities
const detachAllHandlers = (socket: Socket) => {
  if (!socket) return
  
  socket.off('connect', onConnect)
  socket.off('disconnect', onDisconnect)
  socket.off('connect_error', onConnectError)
  socket.off('welcome', onWelcome)
  socket.off('quickMatchFound', onQuickMatchFound)
  socket.off('roomUpdate', onRoomUpdate)
  socket.off('matchStart', onMatchStart)
  socket.off('squareClaimed', onSquareClaimed)
  socket.off('claimRejected', onClaimRejected)
  socket.off('stateSync', onStateSync)
  socket.off('matchStateUpdate', onMatchStateUpdate)
  socket.off('result', onResult)
  socket.off('gameResult', onGameResult)
  socket.off('roomJoined', onRoomJoined)
  socket.off('roomLeft', onRoomLeft)
  socket.off('publicRooms', onPublicRooms)
  socket.off('error', onError)
  socket.off('pong', onPong)
  socket.off('rematchPending', onRematchPending)
}

const attachAllHandlers = (socket: Socket) => {
  if (!socket) return
  
  socket.on('connect', onConnect)
  socket.on('disconnect', onDisconnect)
  socket.on('connect_error', onConnectError)
  socket.on('welcome', onWelcome)
  socket.on('quickMatchFound', onQuickMatchFound)
  socket.on('roomUpdate', onRoomUpdate)
  socket.on('matchStart', onMatchStart)
  socket.on('squareClaimed', onSquareClaimed)
  socket.on('claimRejected', onClaimRejected)
  socket.on('stateSync', onStateSync)
  socket.on('matchStateUpdate', onMatchStateUpdate)
  socket.on('result', onResult)
  socket.on('gameResult', onGameResult)
  socket.on('roomJoined', onRoomJoined)
  socket.on('roomLeft', onRoomLeft)
  socket.on('publicRooms', onPublicRooms)
  socket.on('error', onError)
  socket.on('pong', onPong)
  socket.on('rematchPending', onRematchPending)
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
  matchFinishedNotice: null,
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

    // Log all incoming events for diagnostics
    const originalEmit = socket.emit.bind(socket)
    socket.emit = function(event: string, ...args: any[]) {
      console.log(`[Socket→Server] ${event}:`, args)
      return originalEmit(event, ...args)
    }
    
    const originalOn = socket.on.bind(socket)
    socket.on = function(event: string, handler: (...args: any[]) => void) {
      const wrappedHandler = (...args: any[]) => {
        if (event !== 'connect' && event !== 'disconnect') {
          console.log(`[Server→Socket] ${event}:`, args)
        }
        handler(...args)
      }
      return originalOn(event, wrappedHandler)
    }

    // Single-attach guard: detach existing handlers if already attached
    if (handlersAttached) {
      detachAllHandlers(socket)
    }
    
    // Attach all handlers using stable refs
    attachAllHandlers(socket)
    
    // Log handler attachment exactly once
    console.log(JSON.stringify({
      evt: 'frontend.handlers.attached',
      result: true,
      stateSync: true,
      squareClaimed: true
    }))

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
    const { socket, isConnected, matchState, playerId, isFinished, mySeat } = get()
    
    // No-op guards per requirements
    if (isFinished) {
      console.log('claimSquare no-op: game is finished')
      return
    }
    
    if (!matchState) {
      console.log('claimSquare no-op: no match state')
      return
    }
    
    if (mySeat !== matchState.currentTurn) {
      console.log('claimSquare no-op: not my turn')
      return
    }
    
    if (matchState.board[squareId] !== null) {
      console.log('claimSquare no-op: square already occupied')
      return
    }
    
    if (socket && isConnected && matchState && playerId) {
      const selectionId = `claim_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      
      // Add pending claim
      const pendingClaim: PendingClaim = {
        squareId,
        selectionId,
        timestamp: new Date()
      }
      
      const updatedPendingClaims = new Map(get().pendingClaims)
      updatedPendingClaims.set(selectionId, pendingClaim)
      set({ pendingClaims: updatedPendingClaims })
      
      // Send claim to server
      socket.emit('claimSquare', {
        matchId: matchState.id,
        squareId,
        selectionId
      })
      
      console.log(`Claiming square ${squareId} with selectionId ${selectionId}`)
    }
  },

  requestRematch: () => {
    const { socket, isConnected, matchState } = get()
    if (socket && isConnected && matchState && matchState.status === 'finished') {
      console.log('Requesting rematch for match:', matchState.id)
      socket.emit('rematch', { matchId: matchState.id })
      set({ rematchPending: true })
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
