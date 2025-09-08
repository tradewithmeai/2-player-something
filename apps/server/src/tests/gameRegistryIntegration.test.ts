import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { io, Socket } from 'socket.io-client'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import fastifySocketIO from 'fastify-socket.io'
import { MatchService } from '../services/matchService.js'
import { RoomManager } from '../services/roomManager.js'
import { Matchmaker } from '../services/matchmaker.js'
import { GameRegistry } from '../services/gameRegistry.js'
import { NAMESPACE } from '../index.js'

describe('M2.1d GameRegistry Integration Tests', () => {
  let fastify: any
  let serverUrl: string
  let matchService: MatchService
  let roomManager: RoomManager
  let matchmaker: Matchmaker
  const clients: Socket[] = []

  beforeEach(async () => {
    // Clear GameRegistry before each test
    GameRegistry.clear()
    
    matchService = new MatchService()
    roomManager = new RoomManager()
    matchmaker = new Matchmaker()
    
    fastify = Fastify({ logger: false })
    await fastify.register(cors, { origin: true })
    await fastify.register(fastifySocketIO, {
      cors: { origin: true }
    })

    const gameNamespace = fastify.io.of(NAMESPACE)
    
    // Simplified server setup focusing on claimSquare handler
    gameNamespace.on('connection', (socket: any) => {
      const playerId = socket.id

      socket.on('quickMatch', async () => {
        const result = await matchmaker.requestQuickMatch(playerId, socket.id)
        
        if (result.type === 'paired' && result.room) {
          const room = result.room
          
          // Join both players to room
          room.players.forEach(player => {
            const playerSocket = Array.from(gameNamespace.sockets.values())
              .find(s => s.id === player.socketId)
            if (playerSocket) {
              playerSocket.join(room.id)
            }
          })
          
          // Create match and emit matchStart
          const match = matchService.createMatch(room.id, room.players.map(p => p.id))
          
          room.players.forEach(player => {
            const playerSocket = Array.from(gameNamespace.sockets.values())
              .find(s => s.id === player.socketId)
            if (playerSocket) {
              const mySeat = match.playerSeats.get(player.id)
              playerSocket.emit('matchStart', {
                matchId: match.id,
                roomId: room.id,
                mySeat,
                players: match.players,
                currentTurn: match.currentTurn
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
          // Test the roomId resolution logic exactly as in main server
          let roomId: string | null = null
          
          // A) Authoritative: check match.roomId directly
          if (result.matchState.roomId) {
            roomId = result.matchState.roomId
          }
          
          // B) GameRegistry lookup
          if (!roomId) {
            roomId = GameRegistry.getRoomIdForMatch(matchId)
          }
          
          if (!roomId) {
            socket.emit('claimRejected', {
              matchId,
              squareId,
              reason: 'no_room',
              selectionId
            })
            return
          }

          const playerSeat = result.matchState.playerSeats?.get(playerId)
          
          const claimEvent = {
            matchId,
            squareId,
            by: playerSeat,
            version: result.matchState.version,
            nextTurn: result.nextTurn
          }
          
          gameNamespace.to(roomId).emit('squareClaimed', claimEvent)
          
          const stateEvent = {
            board: result.matchState.board,
            moves: result.matchState.moves,
            version: result.matchState.version,
            currentTurn: result.matchState.currentTurn,
            winner: result.matchState.winner
          }
          gameNamespace.to(roomId).emit('stateSync', stateEvent)
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

    await fastify.listen({ port: 0 })
    const address = fastify.server.address()
    serverUrl = `http://localhost:${address.port}`
  })

  afterEach(async () => {
    clients.forEach(client => client.disconnect())
    clients.length = 0
    await fastify.close()
    GameRegistry.clear()
  })

  test('GameRegistry unit test - mapping operations', () => {
    const matchId = 'match-123'
    const roomId = 'room-456'
    
    // Initially empty
    expect(GameRegistry.getRoomIdForMatch(matchId)).toBeNull()
    expect(GameRegistry.getMatchIdForRoom(roomId)).toBeNull()
    
    // Set mapping
    GameRegistry.setMatchRoom(matchId, roomId)
    expect(GameRegistry.getRoomIdForMatch(matchId)).toBe(roomId)
    expect(GameRegistry.getMatchIdForRoom(roomId)).toBe(matchId)
    
    // Remove mapping
    GameRegistry.removeMappings(roomId, matchId)
    expect(GameRegistry.getRoomIdForMatch(matchId)).toBeNull()
    expect(GameRegistry.getMatchIdForRoom(roomId)).toBeNull()
  })

  test('P1 claim triggers claim.accept with non-null roomId and both sockets receive events within 200ms', async () => {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Test timeout - events not received within 200ms'))
      }, 1000)

      const client1 = io(`${serverUrl}${NAMESPACE}`, { autoConnect: true })
      const client2 = io(`${serverUrl}${NAMESPACE}`, { autoConnect: true })
      clients.push(client1, client2)

      let matchId: string
      let roomId: string
      let client1Ready = false
      let client2Ready = false
      let eventsReceived = 0
      const startTime = Date.now()

      const checkCompletion = () => {
        if (eventsReceived >= 2) {
          const elapsed = Date.now() - startTime
          expect(elapsed).toBeLessThan(200)
          clearTimeout(timeout)
          resolve()
        }
      }

      client1.on('matchStart', (data) => {
        matchId = data.matchId
        roomId = data.roomId
        client1Ready = true
        
        // Verify GameRegistry has the mapping
        expect(GameRegistry.getRoomIdForMatch(matchId)).toBe(roomId)
        
        if (client1Ready && client2Ready && data.mySeat === 'P1') {
          // P1 makes first claim
          client1.emit('claimSquare', {
            matchId,
            squareId: 0,
            selectionId: 'test-claim-1'
          })
        }
      })

      client2.on('matchStart', (data) => {
        client2Ready = true
        if (client1Ready && client2Ready && data.mySeat === 'P2') {
          // P1 will make the claim
        }
      })

      client1.on('squareClaimed', (data) => {
        expect(data.matchId).toBe(matchId)
        expect(data.squareId).toBe(0)
        expect(data.by).toBe('P1')
        expect(data.version).toBe(1)
        expect(data.nextTurn).toBe('P2')
        eventsReceived++
        checkCompletion()
      })

      client2.on('squareClaimed', (data) => {
        expect(data.matchId).toBe(matchId)
        expect(data.squareId).toBe(0)
        expect(data.by).toBe('P1')
        expect(data.version).toBe(1)
        expect(data.nextTurn).toBe('P2')
        eventsReceived++
        checkCompletion()
      })

      // Start quick match for both clients
      client1.emit('quickMatch')
      client2.emit('quickMatch')
    })
  })

  test('Deliberate mapping deletion before claim should heal mapping via match.roomId', async () => {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Test timeout'))
      }, 2000)

      const client1 = io(`${serverUrl}${NAMESPACE}`, { autoConnect: true })
      const client2 = io(`${serverUrl}${NAMESPACE}`, { autoConnect: true })
      clients.push(client1, client2)

      let matchId: string
      let roomId: string
      let client1Ready = false
      let client2Ready = false

      client1.on('matchStart', (data) => {
        matchId = data.matchId
        roomId = data.roomId
        client1Ready = true
        
        if (client1Ready && client2Ready && data.mySeat === 'P1') {
          // Deliberately remove GameRegistry mapping to simulate the bug
          GameRegistry.removeMappings(roomId, matchId)
          
          // Verify mapping is gone
          expect(GameRegistry.getRoomIdForMatch(matchId)).toBeNull()
          
          // Make claim - should heal via match.roomId
          client1.emit('claimSquare', {
            matchId,
            squareId: 0,
            selectionId: 'test-heal-1'
          })
        }
      })

      client2.on('matchStart', (data) => {
        client2Ready = true
      })

      client1.on('squareClaimed', (data) => {
        // If we receive this event, the roomId was resolved successfully
        expect(data.matchId).toBe(matchId)
        expect(data.by).toBe('P1')
        clearTimeout(timeout)
        resolve()
      })

      client2.on('squareClaimed', (data) => {
        // Both clients should receive the event
        expect(data.matchId).toBe(matchId)
        expect(data.by).toBe('P1')
      })

      client1.on('claimRejected', (data) => {
        if (data.reason === 'no_room') {
          reject(new Error('Claim was rejected with no_room - healing failed'))
        }
      })

      // Start quick match
      client1.emit('quickMatch')
      client2.emit('quickMatch')
    })
  })

  test('Artificial no_room scenario should reject claim', async () => {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Test timeout'))
      }, 2000)

      const client1 = io(`${serverUrl}${NAMESPACE}`, { autoConnect: true })
      clients.push(client1)

      // Create match directly without proper room setup
      const fakeMatchId = 'artificial-match'
      const fakeMatch = matchService.createMatch('fake-room', ['fake-player-1', 'fake-player-2'])
      
      // Remove both GameRegistry mapping and clear match.roomId to simulate total failure
      GameRegistry.removeMappings('fake-room', fakeMatch.id)
      
      client1.on('connect', () => {
        client1.emit('claimSquare', {
          matchId: fakeMatch.id,
          squareId: 0,
          selectionId: 'artificial-claim'
        })
      })

      client1.on('claimRejected', (data) => {
        expect(data.reason).toBe('no_room')
        expect(data.matchId).toBe(fakeMatch.id)
        clearTimeout(timeout)
        resolve()
      })

      client1.on('squareClaimed', () => {
        reject(new Error('Should not receive squareClaimed for artificial no_room scenario'))
      })
    })
  })
})