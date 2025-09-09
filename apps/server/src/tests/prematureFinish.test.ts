import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { io, Socket } from 'socket.io-client'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import fastifySocketIO from 'fastify-socket.io'
import { MatchService } from '../services/matchService.js'
import { RoomManager } from '../services/roomManager.js'
import { Matchmaker } from '../services/matchmaker.js'
import { NAMESPACE } from '../index.js'

describe('M2.2c-REGRESSION-GUARD Tests', () => {
  let fastify: any
  let serverUrl: string
  let matchService: MatchService
  let roomManager: RoomManager
  let matchmaker: Matchmaker
  const clients: Socket[] = []
  let emittedResults = new Set<string>()

  beforeEach(async () => {
    matchmaker = new Matchmaker()
    roomManager = new RoomManager()
    matchService = new MatchService()
    emittedResults = new Set<string>()
    
    fastify = Fastify({ logger: false })
    await fastify.register(cors, { origin: true })
    await fastify.register(fastifySocketIO, {
      cors: { origin: true }
    })

    // Copy the exact game logic from main server
    const gameNamespace = fastify.io.of(NAMESPACE)
    
    gameNamespace.on('connection', (socket: any) => {
      const playerId = socket.id

      socket.on('quickMatch', async () => {
        const result = await matchmaker.requestQuickMatch(playerId, socket.id)
        
        if (result.type === 'paired' && result.room) {
          const room = result.room
          
          room.players.forEach(player => {
            const playerSocket = Array.from(gameNamespace.sockets.values())
              .find((s: any) => s.id === player.socketId)
            
            if (playerSocket) {
              playerSocket.join(room.id)
              const update = roomManager.createRoomUpdate(room, 'player_joined')
              playerSocket.emit('quickMatchFound', update.room)
            }
          })
          
          const matchState = matchService.createMatch(room.id, room.players.map(p => p.id))
          roomManager.setMatchRoom(matchState.id, room.id)
          
          // Send matchStart with seat info
          Array.from(gameNamespace.sockets.values()).forEach(sock => {
            const pid = sock.id
            const mySeat = matchState.playerSeats.get(pid)
            
            if (mySeat) {
              sock.emit('matchStart', {
                matchId: matchState.id,
                roomId: matchState.roomId,
                board: matchState.board,
                players: matchState.players,
                mySeat,
                currentTurn: matchState.currentTurn,
                version: matchState.version,
                status: matchState.status
              })
            }
          })
        }
      })

      socket.on('claimSquare', async (data) => {
        const { matchId, squareId, selectionId } = data
        
        const result = await matchService.claimSquare({
          matchId,
          squareId, 
          selectionId,
          playerId
        })

        if (result.success && result.move && result.matchState) {
          const roomId = result.matchState.roomId
          const playerSeat = result.matchState.playerSeats?.get(playerId)
          
          const claimEvent = {
            matchId,
            squareId,
            by: playerSeat,
            version: result.matchState.version,
            nextTurn: result.nextTurn
          }
          
          gameNamespace.to(roomId).emit('squareClaimed', claimEvent)
          
          // Emit result exactly once when finished
          if (result.matchState.status === 'finished' && !emittedResults.has(matchId)) {
            emittedResults.add(matchId)
            
            const resultData = {
              matchId,
              winner: result.matchState.winner,
              line: result.matchState.winningLine
            }
            
            gameNamespace.to(roomId).emit('result', resultData)
          }
        } else {
          socket.emit('claimRejected', {
            matchId,
            squareId,
            reason: result.reason || 'unknown',
            selectionId
          })
        }
      })
    })

    // Add debug endpoint  
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
      }
    })

    await fastify.listen({ port: 0 })
    const address = fastify.server.address()
    serverUrl = `http://localhost:${address.port}`
  })

  afterEach(async () => {
    clients.forEach(client => client.disconnect())
    clients.length = 0
    await fastify.close()
    matchmaker.destroy()
    roomManager.destroy()
  })

  test('first move does not finish', async () => {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Test timeout'))
      }, 5000)

      let matchData: any = null
      let squareClaimedCount = 0
      let resultReceived = false

      const client1 = io(`${serverUrl}${NAMESPACE}`)
      const client2 = io(`${serverUrl}${NAMESPACE}`)
      clients.push(client1, client2)

      // Track result events - should not receive any
      client1.on('result', () => {
        resultReceived = true
      })
      client2.on('result', () => {
        resultReceived = true
      })

      client1.on('matchStart', (data) => {
        matchData = data
        expect(data.currentTurn).toBe('P1')
        expect(data.version).toBe(0)
        expect(data.board.every((cell: any) => cell === null)).toBe(true)
        
        // Get server match state via debug endpoint
        fetch(`${serverUrl}/debug/match?matchId=${data.matchId}`)
          .then(res => res.json())
          .then(serverMatch => {
            expect(serverMatch.winner).toBeNull()
            expect(serverMatch.version).toBe(0)
            expect(serverMatch.board.every((cell: any) => cell === null)).toBe(true)
            
            // P1 makes first move
            client1.emit('claimSquare', {
              matchId: data.matchId,
              squareId: 0,
              selectionId: 't1'
            })
          })
      })

      client1.on('squareClaimed', (data) => {
        squareClaimedCount++
        expect(data.version).toBe(1)
        expect(data.nextTurn).toBe('P2')
        
        // Verify server match still not finished
        fetch(`${serverUrl}/debug/match?matchId=${data.matchId}`)
          .then(res => res.json())
          .then(serverMatch => {
            expect(serverMatch.winner).toBeNull()
            expect(serverMatch.finishedAt).toBeUndefined()
            expect(resultReceived).toBe(false)
            
            clearTimeout(timeout)
            resolve()
          })
      })

      client1.on('connect', () => {
        client1.emit('quickMatch')
      })

      client2.on('connect', () => {
        client2.emit('quickMatch')
      })
    })
  })

  test('two non-winning moves still no result', async () => {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Test timeout'))
      }, 5000)

      let matchData: any = null
      let squareClaimedCount = 0
      let resultReceived = false

      const client1 = io(`${serverUrl}${NAMESPACE}`)
      const client2 = io(`${serverUrl}${NAMESPACE}`)
      clients.push(client1, client2)

      // Track result events - should not receive any
      client1.on('result', () => {
        resultReceived = true
      })
      client2.on('result', () => {
        resultReceived = true
      })

      client1.on('matchStart', (data) => {
        matchData = data
        
        // P1 makes first move
        client1.emit('claimSquare', {
          matchId: data.matchId,
          squareId: 0,
          selectionId: 't1'
        })
      })

      client2.on('squareClaimed', (data) => {
        squareClaimedCount++
        
        if (squareClaimedCount === 1) {
          // After P1's move
          expect(data.version).toBe(1)
          expect(data.nextTurn).toBe('P2')
          
          // P2 makes second move
          client2.emit('claimSquare', {
            matchId: matchData.matchId,
            squareId: 4,
            selectionId: 't2'
          })
        } else if (squareClaimedCount === 2) {
          // After P2's move
          expect(data.version).toBe(2)
          expect(data.nextTurn).toBe('P1')
          
          // Verify server match still not finished
          fetch(`${serverUrl}/debug/match?matchId=${data.matchId}`)
            .then(res => res.json())
            .then(serverMatch => {
              expect(serverMatch.winner).toBeNull()
              expect(serverMatch.finishedAt).toBeUndefined()
              expect(resultReceived).toBe(false)
              
              clearTimeout(timeout)
              resolve()
            })
        }
      })

      client1.on('connect', () => {
        client1.emit('quickMatch')
      })

      client2.on('connect', () => {
        client2.emit('quickMatch')
      })
    })
  })
})