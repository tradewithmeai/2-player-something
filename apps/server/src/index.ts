import Fastify from 'fastify'
import cors from '@fastify/cors'
import fastifySocketIO from 'fastify-socket.io'
import { Socket } from 'socket.io'
import 'dotenv/config'
import { RoomManager } from './services/roomManager.js'
import { Matchmaker } from './services/matchmaker.js'
import { MatchService } from './services/matchService.js'
import { GameRegistry } from './services/gameRegistry.js'
import { ClientToServerEvents, ServerToClientEvents } from './types/room.js'

// Single namespace constant
export const NAMESPACE = '/game'


// Create global service instances
const roomManager = new RoomManager()
const matchmaker = new Matchmaker()
const matchService = new MatchService()

// Track emitted results to ensure exactly-once emission
const emittedResults = new Set<string>()

// Configuration
const PORT = process.env.NODE_ENV === 'development' ? 8890 : parseInt(process.env.PORT || '9001', 10)
const HOST = process.env.HOST || '0.0.0.0'
const MATCH_MODE = process.env.MATCH_MODE || 'turn'
const SIMUL_WINDOW_MS = parseInt(process.env.SIMUL_WINDOW_MS || '500', 10)
const SIMUL_STARTER_ALTERNATION = process.env.SIMUL_STARTER_ALTERNATION === 'true'

const fastify = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'development' ? 'info' : 'warn',
  },
})

await fastify.register(cors, {
  origin: true, // Allow all origins for development
  methods: ['GET', 'POST'],
  credentials: true,
})

await fastify.register(fastifySocketIO, {
  cors: {
    origin: true, // Allow all origins for development
    methods: ['GET', 'POST'],
    credentials: true,
  },
})

fastify.get('/health', async (_request, _reply) => {
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    matchMode: MATCH_MODE,
    simulWindowMs: SIMUL_WINDOW_MS,
    simulStarterAlternation: SIMUL_STARTER_ALTERNATION,
  }
})

// Debug endpoints (dev only)
if (process.env.NODE_ENV !== 'production') {
  fastify.get('/debug/queue', async () => {
    return matchmaker.getQueueStatus()
  })

  fastify.get('/debug/rooms', async () => {
    const roomsStatus = matchmaker.getRoomsStatus()
    const gameRegistryMappings = GameRegistry.getAllMappings()
    const gameRegistryStats = GameRegistry.getStats()
    
    // Get active matches from matchService for comparison
    const activeMatches = Array.from(matchService.getActiveMatches()).map(match => ({
      matchId: match.id,
      roomId: match.roomId,
      status: match.status,
      version: match.version
    }))
    
    return {
      ...roomsStatus,
      gameRegistry: {
        mappings: gameRegistryMappings,
        stats: gameRegistryStats
      },
      activeMatches,
      // Check for mismatches
      mismatches: activeMatches.filter(match => {
        const registryRoomId = GameRegistry.getRoomIdForMatch(match.matchId)
        return registryRoomId !== match.roomId
      })
    }
  })

  fastify.get('/debug/match', async (request, reply) => {
    const { matchId } = request.query as { matchId?: string }
    if (!matchId) {
      reply.code(400)
      return { error: 'matchId query parameter required' }
    }
    
    const match = matchService.getMatch(matchId)
    if (!match) {
      reply.code(404)
      return { error: 'Match not found' }
    }
    
    return {
      matchId: match.id,
      roomId: match.roomId,
      status: match.status,
      version: match.version,
      winner: match.winner,
      winningLine: match.winningLine,
      currentTurn: match.currentTurn,
      moves: match.moves.length,
      board: match.board,
      players: match.players,
      playerSeats: Object.fromEntries(match.playerSeats),
      startedAt: match.startedAt,
      finishedAt: match.finishedAt,
      mode: match.mode,
      currentWindowId: match.currentWindowId,
      currentWindowStarter: match.currentWindowStarter,
      pendingClaims: matchService.getDebugInfo(match.id)?.pendingClaims || {}
    }
  })
}

const gameNamespace = fastify.io.of(NAMESPACE)

// Helper function for comprehensive socket diagnostics
function auditSocketRoomMembership(roomId: string, context: string) {
  const socketsInRoom = Array.from(gameNamespace.adapter.rooms.get(roomId) || [])
  const allSockets = Array.from(gameNamespace.sockets.keys())
  
  console.log(JSON.stringify({
    evt: 'room.audit',
    context,
    roomId,
    socketsInRoom: socketsInRoom.length,
    allSockets: allSockets.length,
    members: socketsInRoom,
    timestamp: new Date().toISOString()
  }))
  
  // Verify each socket actually thinks it's in the room
  socketsInRoom.forEach(socketId => {
    const socket = gameNamespace.sockets.get(socketId)
    if (socket) {
      const socketRooms = Array.from(socket.rooms)
      const inRoom = socket.rooms.has(roomId)
      console.log(JSON.stringify({
        evt: 'socket.rooms',
        socketId,
        inTargetRoom: inRoom,
        allRooms: socketRooms,
        context
      }))
    }
  })
  
  return socketsInRoom
}

// Helper function to ensure socket room membership
function ensureSocketInRoom(socket: any, roomId: string, context: string) {
  if (!socket.rooms.has(roomId)) {
    socket.join(roomId)
    console.log(JSON.stringify({
      evt: 'room.join.forced',
      socketId: socket.id,
      roomId,
      context,
      timestamp: new Date().toISOString()
    }))
    return true
  }
  return false
}

// Helper function to emit matchStart with seat information for each player
function emitMatchStartWithSeats(roomId: string, match: any, matchState: any) {
  console.log(JSON.stringify({
    evt: 'match.start.begin',
    roomId,
    matchId: matchState.id,
    playerCount: matchState.players.length,
    timestamp: new Date().toISOString()
  }))
  
  // Audit room membership before emitting
  const socketsInRoom = auditSocketRoomMembership(roomId, 'matchStart')
  
  // Send personalized matchStart to each player with their seat assignment
  if (matchState.playerSeats) {
    Array.from(gameNamespace.sockets.values()).forEach(socket => {
      const playerId = socket.id
      const mySeat = matchState.playerSeats.get(playerId)
      
      if (mySeat) {
        // Ensure socket is in room before emitting
        ensureSocketInRoom(socket, roomId, 'matchStart')
        
        socket.emit('matchStart', {
          matchId: matchState.id,
          roomId: matchState.roomId,
          board: matchState.board,
          players: matchState.players,
          mySeat,
          currentTurn: matchState.currentTurn,
          version: matchState.version,
          status: matchState.status
        })
        
        console.log(JSON.stringify({
          evt: 'match.start.sent',
          socketId: playerId,
          mySeat,
          roomId,
          currentTurn: matchState.currentTurn
        }))
      }
    })
  }
  
  // Also send matchStateUpdate as before
  gameNamespace.to(roomId).emit('matchStateUpdate', {
    matchId: matchState.id,
    matchState: matchState,
    version: matchState.version
  })
  
  console.log(JSON.stringify({
    evt: 'match.start.complete',
    roomId,
    matchId: matchState.id,
    mode: matchState.mode,
    timestamp: new Date().toISOString()
  }))
  
  // If simul mode, start the first window
  if (matchState.mode === 'simul') {
    setTimeout(() => {
      startSimulWindow(matchState.id, roomId)
    }, 100) // Small delay to ensure clients are ready
  }
}

// Simul window management functions
function startSimulWindow(matchId: string, roomId: string) {
  const windowData = matchService.openSimulWindow(matchId, handleWindowClose)
  if (!windowData) {
    return
  }

  // Emit windowOpen to all players in room
  gameNamespace.to(roomId).emit('windowOpen', windowData)
}

function handleWindowClose(matchId: string, roomId: string) {
  const windowCloseData = matchService.closeSimulWindow(matchId)
  if (!windowCloseData) {
    return
  }

  // Emit windowClose
  gameNamespace.to(roomId).emit('windowClose', windowCloseData)

  // Emit individual squareClaimed events for each applied claim
  for (const applied of windowCloseData.applied) {
    gameNamespace.to(roomId).emit('squareClaimed', {
      matchId,
      squareId: applied.squareId,
      by: applied.seat,
      version: applied.version
    })
  }

  // Emit individual claimRejected events for conflicts
  for (const rejected of windowCloseData.rejected) {
    // Find the player ID for this seat to send rejection
    const match = matchService.getMatch(matchId)
    if (match) {
      const playerId = Array.from(match.playerSeats.entries())
        .find(([_, seat]) => seat === rejected.seat)?.[0]
      
      if (playerId) {
        const socket = gameNamespace.sockets.get(playerId)
        if (socket) {
          socket.emit('claimRejected', {
            matchId,
            squareId: rejected.squareId,
            reason: rejected.reason,
            selectionId: '', // Not available in window close, but client should handle
            version: rejected.version
          })
        }
      }
    }
  }

  // Send updated match state
  const updatedMatch = matchService.getMatch(matchId)
  if (updatedMatch) {
    gameNamespace.to(roomId).emit('stateSync', {
      board: updatedMatch.board,
      moves: updatedMatch.moves,
      version: updatedMatch.version,
      currentTurn: updatedMatch.currentTurn,
      winner: updatedMatch.winner,
      winningLine: updatedMatch.winningLine
    })

    // Check if match finished
    if (updatedMatch.status === 'finished' && !emittedResults.has(matchId)) {
      emittedResults.add(matchId)
      
      const resultData = {
        matchId,
        winner: updatedMatch.winner,
        line: updatedMatch.winningLine
      }
      
      gameNamespace.to(roomId).emit('result', resultData)
      
      console.log(JSON.stringify({
        evt: 'emit.result',
        roomId,
        matchId,
        winner: updatedMatch.winner
      }))
    } else if (updatedMatch.status === 'active') {
      // Start next window if match continues
      setTimeout(() => {
        startSimulWindow(matchId, roomId)
      }, 50) // Brief pause between windows
    }
  }
}

gameNamespace.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
  console.log(`Client connected to game namespace: ${socket.id}`)
  const playerId = socket.id // Using socket.id as player ID for simplicity

  socket.emit('welcome', 'Connected to game server')

  // Room Management Event Handlers
  socket.on('quickMatch', async () => {
    console.log(`Player ${playerId} requesting quick match`)
    
    const result = await matchmaker.requestQuickMatch(playerId, socket.id)
    
    if (result.type === 'queued') {
      console.log(`Player ${playerId} added to quick match queue`)
      // Player is queued, they'll be paired when another player joins
    } else if (result.type === 'paired' && result.room) {
      const room = result.room
      
      // Both players need to join the Socket.IO room
      // Find both sockets and join them
      room.players.forEach(player => {
        const playerSocket = Array.from(gameNamespace.sockets.values())
          .find(s => s.id === player.socketId)
        
        if (playerSocket) {
          playerSocket.join(room.id)
          
          // Send quickMatchFound to each player
          const update = roomManager.createRoomUpdate(room, 'player_joined')
          playerSocket.emit('quickMatchFound', update.room)
          playerSocket.emit('roomUpdate', update)
          
          console.log(`Player ${player.id} joined room ${room.code}`)
        }
      })
      
      // Start the match immediately since both players are present
      const match = {
        roomId: room.id,
        players: room.players,
        startedAt: new Date()
      }
      
      // Create server-side match state for the game
      const matchState = matchService.createMatch(room.id, room.players.map(p => p.id))
      
      // Map matchId to roomId
      roomManager.setMatchRoom(matchState.id, room.id)
      
      // Send initial match state with seat info to clients
      emitMatchStartWithSeats(room.id, match, matchState)
      
      console.log(`Match started in room ${room.code} with matchId ${matchState.id}, players:`, room.players.map(p => p.id))
      
      // Start watchdog for join acknowledgment
      matchmaker.startWatchdog(room.id, () => {
        // Force both players to acknowledge they're in the room
        console.log(`Watchdog: Re-sending match start for room ${room.code}`)
        emitMatchStartWithSeats(room.id, match, matchState)
      })
    }
  })

  socket.on('createRoom', (isPublic = false) => {
    console.log(`Player ${playerId} creating room (public: ${isPublic})`)
    
    // Leave any existing room first
    const existingRoom = roomManager.getRoomByPlayerId(playerId)
    if (existingRoom) {
      socket.leave(existingRoom.id)
      roomManager.leaveRoom(playerId)
    }
    
    const room = roomManager.createRoom(playerId, socket.id, isPublic)
    socket.join(room.id)
    
    const update = roomManager.createRoomUpdate(room, 'player_joined')
    socket.emit('roomJoined', update.room)
    
    console.log(`Room created: ${room.code} by player ${playerId}`)
  })

  socket.on('joinRoom', (code: string) => {
    console.log(`Player ${playerId} trying to join room ${code}`)
    
    // Leave any existing room first
    const existingRoom = roomManager.getRoomByPlayerId(playerId)
    if (existingRoom) {
      socket.leave(existingRoom.id)
      roomManager.leaveRoom(playerId)
    }
    
    const room = roomManager.joinRoom(playerId, socket.id, code)
    if (room) {
      socket.join(room.id)
      const update = roomManager.createRoomUpdate(room, 'player_joined')
      
      // Notify all players in room
      gameNamespace.to(room.id).emit('roomUpdate', update)
      socket.emit('roomJoined', update.room)
      
      console.log(`Player ${playerId} joined room ${room.code}`)
      
      // Check if match should start
      if (room.status === 'active') {
        const match = {
          roomId: room.id,
          players: room.players,
          startedAt: new Date()
        }
        
        // Create MatchState for the tic-tac-toe game
        const playerIds = room.players.map(p => p.id)
        const matchState = matchService.createMatch(room.id, playerIds)
        
        // Map matchId to roomId
        roomManager.setMatchRoom(matchState.id, room.id)
        
        emitMatchStartWithSeats(room.id, match, matchState)
        console.log(`Match started in room ${room.code} with matchId ${matchState.id}`)
      }
    } else {
      socket.emit('error', 'Room not found, full, or already active')
      console.log(`Failed to join room ${code} for player ${playerId}`)
    }
  })

  socket.on('leaveRoom', () => {
    console.log(`Player ${playerId} leaving room`)
    const room = roomManager.leaveRoom(playerId)
    
    if (room) {
      socket.leave(room.id)
      const update = roomManager.createRoomUpdate(room, 'player_left')
      gameNamespace.to(room.id).emit('roomUpdate', update)
      console.log(`Player ${playerId} left room ${room.code}`)
    }
    
    socket.emit('roomLeft')
  })

  socket.on('getPublicRooms', () => {
    const rooms = roomManager.getPublicRooms()
    const roomUpdates = rooms.map(room => 
      roomManager.createRoomUpdate(room, 'status_changed').room
    )
    socket.emit('publicRooms', roomUpdates)
  })

  socket.on('playerReady', (ready: boolean) => {
    console.log(`Player ${playerId} ready status: ${ready}`)
    const room = roomManager.updatePlayerReady(playerId, ready)
    
    if (room) {
      const update = roomManager.createRoomUpdate(room, 'status_changed')
      gameNamespace.to(room.id).emit('roomUpdate', update)
      
      // Check if match should start
      if (room.status === 'active') {
        const match = {
          roomId: room.id,
          players: room.players,
          startedAt: new Date()
        }
        
        // Create MatchState for the tic-tac-toe game
        const playerIds = room.players.map(p => p.id)
        const matchState = matchService.createMatch(room.id, playerIds)
        
        // Map matchId to roomId
        roomManager.setMatchRoom(matchState.id, room.id)
        
        emitMatchStartWithSeats(room.id, match, matchState)
        console.log(`Match started in room ${room.code} (all players ready)`)
      }
    }
  })

  socket.on('claimSquare', async (data) => {
    const { matchId: clientMatchId, squareId, selectionId } = data
    
    // Resolve authoritative matchId from GameRegistry via socket's room
    const socketRooms = Array.from(socket.rooms).filter(r => r !== socket.id)
    const roomId = socketRooms.find(r => GameRegistry.getMatchIdForRoom(r))
    const authoritativeMatchId = roomId ? GameRegistry.getMatchIdForRoom(roomId) : null
    
    // Log mismatch if client provided wrong matchId but continue with authoritative one
    if (clientMatchId && authoritativeMatchId && clientMatchId !== authoritativeMatchId) {
      console.log(JSON.stringify({
        evt: 'claim.mismatch',
        provided: clientMatchId,
        expected: authoritativeMatchId,
        playerId,
        squareId,
        selectionId,
        timestamp: new Date().toISOString()
      }))
    }
    
    const matchId = authoritativeMatchId || clientMatchId
    
    console.log(JSON.stringify({
      evt: 'claim.received',
      playerId,
      matchId,
      squareId,
      selectionId,
      timestamp: new Date().toISOString()
    }))

    if (!matchId) {
      socket.emit('claimRejected', {
        squareId,
        selectionId,
        reason: 'invalid_match'
      })
      return
    }

    const result = await matchService.claimSquare({
      matchId,
      squareId, 
      selectionId,
      playerId
    })

    if (result.success && result.move && result.matchState) {
      // Resolve roomId with failsafe order: match.roomId -> GameRegistry -> socket inference
      let roomId: string | null = null
      
      // A) Authoritative: check match.roomId directly
      if (result.matchState.roomId) {
        roomId = result.matchState.roomId
      }
      
      // B) GameRegistry lookup
      if (!roomId) {
        roomId = GameRegistry.getRoomIdForMatch(matchId)
        if (roomId) {
          console.log(JSON.stringify({
            evt: 'claim.roomId.healed.registry',
            matchId,
            roomId,
            warning: 'match.roomId was null but registry had mapping'
          }))
        }
      }
      
      // C) Fallback: infer from socket rooms (with warning)
      if (!roomId) {
        const socketRooms = Array.from(socket.rooms)
        const knownRooms = roomManager.getAllRooms().map(r => r.id)
        const intersection = socketRooms.filter(r => knownRooms.includes(r))
        
        if (intersection.length > 0) {
          roomId = intersection[0]
          console.log(JSON.stringify({
            evt: 'claim.roomId.healed.inference',
            matchId,
            roomId,
            warning: 'both match.roomId and registry were null, inferred from socket.rooms',
            socketRooms,
            knownRooms: knownRooms.slice(0, 5) // limit log size
          }))
          
          // Heal the mapping
          GameRegistry.setMatchRoom(matchId, roomId)
        }
      }
      
      // If no roomId after all attempts, reject the claim
      if (!roomId) {
        console.log(JSON.stringify({
          evt: 'claim.error.no_room',
          playerId,
          matchId,
          squareId,
          reason: 'failed to resolve roomId after match.roomId, GameRegistry, and socket inference'
        }))
        
        socket.emit('claimRejected', {
          matchId,
          squareId,
          reason: 'no_room',
          selectionId
        })
        return
      }
      
      // Log successful claim with resolved roomId
      console.log(JSON.stringify({
        evt: 'claim.accept',
        matchId,
        roomId,
        squareId,
        version: result.matchState.version,
        nextTurn: result.nextTurn
      }))
      
      // Audit room membership before emitting
      auditSocketRoomMembership(roomId, 'claimSquare')
      
      // Ensure all players are in the room
      result.matchState.players.forEach(pid => {
        const playerSocket = gameNamespace.sockets.get(pid)
        if (playerSocket) {
          ensureSocketInRoom(playerSocket, roomId!, 'claimSquare')
        }
      })
      
      // Ensure claiming socket is also in room
      ensureSocketInRoom(socket, roomId, 'claimSquare')

      // Get player seat for the claim
      const playerSeat = result.matchState.playerSeats?.get(playerId)
      
      // Emit squareClaimed with exact spec payload
      const claimEvent = {
        matchId,
        squareId,
        by: playerSeat, // Send seat instead of playerId
        version: result.matchState.version,
        nextTurn: result.nextTurn
      }
      
      gameNamespace.to(roomId).emit('squareClaimed', claimEvent)
      
      console.log(JSON.stringify({
        evt: 'emit.squareClaimed',
        matchId,
        roomId,
        squareId,
        version: result.matchState.version
      }))

      // Emit stateSync for redundancy
      const stateEvent = {
        board: result.matchState.board,
        moves: result.matchState.moves,
        version: result.matchState.version,
        currentTurn: result.matchState.currentTurn,
        winner: result.matchState.winner,
        winningLine: result.matchState.winningLine
      }
      gameNamespace.to(roomId).emit('stateSync', stateEvent)
      
      console.log(JSON.stringify({
        evt: 'emit.stateSync',
        matchId,
        roomId,
        version: result.matchState.version
      }))

      // Check if game finished - emit result exactly once
      if (result.matchState.status === 'finished' && !emittedResults.has(matchId)) {
        // Mark as emitted first to prevent double emission
        emittedResults.add(matchId)
        
        const resultData = {
          matchId,
          winner: result.matchState.winner,
          line: result.matchState.winningLine
        }
        
        // Emit result event (required by spec)
        gameNamespace.to(roomId).emit('result', resultData)
        
        // Log emit.result for structured logging
        console.log(JSON.stringify({
          evt: 'emit.result',
          roomId,
          matchId,
          winner: result.matchState.winner
        }))
        
        // Legacy compatibility
        gameNamespace.to(roomId).emit('gameResult', resultData)
      }
    } else {
      // Send rejection only to the requesting player
      socket.emit('claimRejected', {
        matchId,
        squareId,
        reason: result.reason || 'unknown',
        selectionId
      })
      console.log(JSON.stringify({ 
        evt: 'claim.reject.sent', 
        matchId, 
        squareId, 
        reason: result.reason || 'unknown',
        playerId,
        selectionId
      }))
    }
  })

  socket.on('rematch', async (data) => {
    const { matchId } = data
    
    console.log(JSON.stringify({
      evt: 'rematch.received',
      playerId,
      matchId,
      timestamp: new Date().toISOString()
    }))

    const result = await matchService.requestRematch({
      matchId,
      playerId
    })

    if (result.type === 'waiting') {
      // Find the room for this match to broadcast to both players
      const match = matchService.getMatch(matchId)
      const roomId = match?.roomId
      const requesterSeat = match?.playerSeats?.get(playerId)
      
      if (roomId && requesterSeat) {
        // Emit rematchPending to BOTH players in the room
        gameNamespace.to(roomId).emit('rematchPending', { 
          matchId, 
          requesterSeat 
        })
        
        console.log(JSON.stringify({ 
          evt: 'rematch.pending', 
          matchId, 
          playerId, 
          requesterSeat, 
          roomId 
        }))
      }
    } else if (result.type === 'matched' && result.newMatchId) {
      const match = matchService.getMatch(result.newMatchId)
      if (match) {
        // Use same helper as match start to emit to both players
        emitMatchStartWithSeats(match.roomId, { 
          roomId: match.roomId, 
          players: match.players.map(pid => ({ id: pid, socketId: pid })), 
          startedAt: match.startedAt 
        }, match)
        
        console.log(JSON.stringify({
          evt: 'rematch.start',
          oldMatchId: matchId,
          newMatchId: result.newMatchId,
          roomId: match.roomId
        }))
      }
    } else if (result.type === 'timeout') {
      // Handle rematch timeout - emit to both players
      const match = matchService.getMatch(matchId)
      if (match?.roomId) {
        gameNamespace.to(match.roomId).emit('rematchTimeout', { matchId })
        
        console.log(JSON.stringify({
          evt: 'rematch.timeout',
          matchId,
          roomId: match.roomId
        }))
      }
    }
  })

  // Legacy ping/pong for testing
  socket.on('ping', () => {
    console.log('Received ping from', socket.id)
    socket.emit('pong')
  })

  socket.on('disconnect', async (reason) => {
    console.log(`Player ${playerId} disconnected: ${reason}`)
    
    // Remove from matchmaking queue if present
    await matchmaker.removeFromQueue(playerId)
    
    // Clean up player from room
    const room = roomManager.leaveRoom(playerId)
    if (room) {
      const update = roomManager.createRoomUpdate(room, 'player_left')
      gameNamespace.to(room.id).emit('roomUpdate', update)
      console.log(`Player ${playerId} auto-removed from room ${room.code} on disconnect`)
    }
  })
})

fastify.io.on('connection', (socket: Socket) => {
  console.log(`Client connected to default namespace: ${socket.id}`)

  socket.on('ping', () => {
    console.log('Received ping from', socket.id)
    socket.emit('pong')
  })

  socket.on('disconnect', (reason) => {
    console.log(`Client disconnected: ${socket.id}, reason: ${reason}`)
  })
})

// Graceful shutdown handling
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, starting graceful shutdown...')
  roomManager.destroy()
  await fastify.close()
  console.log('Server closed gracefully')
  process.exit(0)
})

process.on('SIGINT', async () => {
  console.log('SIGINT received, starting graceful shutdown...')
  roomManager.destroy()
  await fastify.close()
  console.log('Server closed gracefully')
  process.exit(0)
})

const start = async () => {
  try {
    await fastify.listen({ port: PORT, host: HOST })
    
    // Exact log format as requested
    console.log(JSON.stringify({
      evt: 'server.start',
      port: PORT,
      namespace: NAMESPACE,
      matchMode: MATCH_MODE,
      simulWindowMs: SIMUL_WINDOW_MS,
      simulStarterAlternation: SIMUL_STARTER_ALTERNATION
    }))
  } catch (err: any) {
    if (err.code === 'EADDRINUSE') {
      console.log(JSON.stringify({
        evt: 'server.error',
        error: 'EADDRINUSE',
        port: PORT,
        message: `Port ${PORT} is already in use`
      }))
      process.exit(1)
    }
    fastify.log.error(err)
    process.exit(1)
  }
}

start()
