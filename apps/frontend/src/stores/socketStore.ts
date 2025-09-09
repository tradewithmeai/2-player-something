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

export const useSocketStore = create<SocketState>((set, get) => ({
  // Initial state
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
  isFinished: false,
  rematchPending: false,
  matchFinishedNotice: null,
  lastPong: null,
  serverTime: null,

  connect: () => {
    const { socket: existingSocket } = get()
    if (existingSocket?.connected) return

    set({ connectionStatus: 'connecting' })

    console.log(`[SocketStore] Connecting to ${SERVER_URL}${NAMESPACE}`)
    
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
      return originalOn(event, (...args: any[]) => {
        if (event !== 'connect' && event !== 'disconnect') {
          console.log(`[Server→Socket] ${event}:`, args)
        }
        handler(...args)
      })
    }

    // Connection events
    socket.on('connect', () => {
      console.log('Connected to server:', socket.id)
      set({
        isConnected: true,
        connectionStatus: 'connected',
        socket,
        playerId: socket.id,
      })
    })

    socket.on('disconnect', reason => {
      console.log('Disconnected from server:', reason)
      set({
        isConnected: false,
        connectionStatus: 'disconnected',
        currentRoom: null,
        inQueue: false,
        currentMatch: null,
        matchState: null,
        pendingClaims: new Map(),
        playerId: null,
        gameInputLocked: false,
      })
    })

    socket.on('connect_error', error => {
      console.error('Connection error:', error)
      set({
        isConnected: false,
        connectionStatus: 'error',
      })
    })

    // Room events
    socket.on('roomUpdate', (update: RoomUpdate) => {
      console.log('Room update received:', update)
      set({ currentRoom: update.room })
    })

    socket.on('matchStart', (data: Match & { matchId?: string; mySeat?: 'P1' | 'P2'; currentTurn?: 'P1' | 'P2'; players?: string[] }) => {
      console.log('Match started:', data)
      
      // Initialize/reset match state for new or rematch games  
      if (!data.matchId) {
        console.error('matchStart received without matchId:', data)
        return
      }
      
      const newMatchState: MatchState = {
        id: data.matchId,
        roomId: data.roomId,
        board: Array(9).fill(null),
        players: data.players || data.players || [],
        currentTurn: data.currentTurn || 'P1',
        moves: [],
        version: 0,
        status: 'active',
        winner: null,
        winningLine: null,
        startedAt: data.startedAt,
        finishedAt: undefined
      }
      
      // Reset all game and UI state for fresh match/rematch
      set({ 
        currentMatch: data,
        mySeat: data.mySeat || null,
        matchState: newMatchState,
        gameInputLocked: false,
        isFinished: false,
        rematchPending: false,
        matchFinishedNotice: null,
        pendingClaims: new Map()
      })
    })

    // Match events
    socket.on('matchStateUpdate', (data: { matchId: string; matchState: MatchState; version: number }) => {
      console.log('Match state update:', data)
      const state = get()
      
      // Guard versioning: ignore events with version <= currentVersion
      if (state.matchState && data.version <= state.matchState.version) {
        console.log('Ignoring stale version:', data.version, 'current:', state.matchState.version)
        return
      }
      
      set({
        matchState: data.matchState
      })
    })

    socket.on('squareClaimed', (data: { matchId: string; squareId: number; by: string; version: number; nextTurn?: string }) => {
      const state = get()
      
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
          if (claim.squareId === data.squareId) {
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
        
        set({
          matchState: newState,
          pendingClaims: updatedPendingClaims
        })
      } else {
        console.log(`[SquareClaimed] DROPPED: no matchState available`)
      }
    })

    socket.on('claimRejected', (data: { matchId: string; squareId: number; reason: string; selectionId: string }) => {
      console.log('Claim rejected:', data)
      const state = get()
      
      // Remove the rejected pending claim
      const updatedPendingClaims = new Map(state.pendingClaims)
      updatedPendingClaims.delete(data.selectionId)
      
      set({
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
        set({
          isFinished: true,
          matchFinishedNotice: 'Round finished — start a rematch'
        })
      }
    })

    // Add stateSync handler for atomic state updates
    socket.on('stateSync', (data: { board: (string | null)[]; moves: Move[]; version: number; currentTurn: string; winner?: 'P1' | 'P2' | 'draw' | null; winningLine?: number[] | null }) => {
      const state = get()
      
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
      
      if (data.version <= state.matchState.version) {
        console.log(`[StateSync] DROPPED: stale version. Event: ${data.version}, Current: ${state.matchState.version}`)
        return
      }
      
      // Clear pending claims for occupied squares
      const updatedPendingClaims = new Map(state.pendingClaims)
      const clearedClaims: string[] = []
      
      for (const [selectionId, claim] of updatedPendingClaims.entries()) {
        if (data.board[claim.squareId] !== null) {
          updatedPendingClaims.delete(selectionId)
          clearedClaims.push(selectionId)
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
        boardChanges: state.matchState.board.map((old, i) => old !== data.board[i] ? `${i}: ${old} → ${data.board[i]}` : null).filter(Boolean),
        oldTurn: state.matchState.currentTurn,
        newTurn: newState.currentTurn,
        clearedClaims,
        pendingClaimsRemaining: updatedPendingClaims.size
      })
      
      set(uiState)
    })

    // Handle both result (spec) and legacy gameResult
    const handleGameResult = (data: { matchId: string; winner: 'P1' | 'P2' | 'draw' | null; line?: number[] | null; winningLine?: number[] | null }) => {
      console.log('Game result:', data)
      
      // Log frontend.result.received for structured logging
      console.log(JSON.stringify({
        evt: 'frontend.result.received',
        matchId: data.matchId,
        winner: data.winner
      }))
      
      const state = get()
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
        
        set({ 
          matchState: updatedMatchState,
          isFinished: true,
          gameInputLocked: true,
          rematchPending: false // Clear any pending rematch state
        })
      } else {
        // Fallback: just lock input and set finished
        set({ 
          gameInputLocked: true,
          isFinished: true
        })
      }
      
      // Show winner/draw
      console.log(data.winner === 'draw' ? 'Draw!' : data.winner ? `Winner: ${data.winner}` : 'Game Over!', line ? `Winning line: ${line}` : '')
    }

    socket.on('result', handleGameResult)
    socket.on('gameResult', handleGameResult) // Legacy compatibility
    
    // Log HMR-safe handler registration
    console.log(JSON.stringify({
      evt: 'frontend.handlers.attached',
      result: true,
      stateSync: true
    }))

    socket.on('roomJoined', (room: Room) => {
      console.log('Joined room:', room)
      set({ currentRoom: room, inQueue: false })
    })

    socket.on('roomLeft', () => {
      console.log('Left room')
      set({ currentRoom: null, inQueue: false })
    })

    socket.on('quickMatchFound', (room: Room) => {
      console.log('Quick match found:', room)
      set({ currentRoom: room, inQueue: false })
      
      // Ensure we join the room if needed
      setTimeout(() => {
        const state = get()
        if (state.currentRoom?.id === room.id && !state.currentMatch) {
          console.log('Ensuring room join for', room.code)
          socket.emit('joinRoom', room.code)
        }
      }, 1000)
    })

    socket.on('publicRooms', (rooms: Room[]) => {
      console.log('Public rooms received:', rooms)
      set({ publicRooms: rooms })
    })

    socket.on('error', (message: string) => {
      console.error('Server error:', message)
      alert(`Error: ${message}`)
    })

    // Legacy events
    socket.on('welcome', data => {
      console.log('Welcome message:', data)
    })

    socket.on('pong', data => {
      console.log('Received pong:', data)
      set({
        lastPong: new Date().toISOString(),
        serverTime: data.serverTime,
      })
    })

    // Rematch event handlers
    socket.on('rematchPending', (data) => {
      console.log('Rematch pending:', data)
      set({ rematchPending: true })
    })


    set({ socket })
  },

  disconnect: () => {
    const { socket } = get()
    if (socket) {
      socket.disconnect()
      set({
        socket: null,
        isConnected: false,
        connectionStatus: 'disconnected',
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
    const { socket, isConnected, matchState, playerId, isFinished } = get()
    
    // No-op when game is finished
    if (isFinished) {
      console.log('claimSquare no-op: game is finished')
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
}))
