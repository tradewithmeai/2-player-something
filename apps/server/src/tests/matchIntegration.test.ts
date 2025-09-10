import { describe, test, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { io, Socket } from 'socket.io-client'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import fastifySocketIO from 'fastify-socket.io'
import { MatchService } from '../services/matchService.js'
import { waitForSocketEvent, waitForMultipleSocketEvents, getMode, skipIfNotMode } from './utils/testEvents.js'

describe('Match Integration Tests - Race Conditions', () => {
  let fastify: any
  let serverUrl: string
  let matchService: MatchService
  // Unused but required for future expansion
  // let roomManager: RoomManager  
  // let matchmaker: Matchmaker
  const clients: Socket[] = []
  const playerIdMapping = new Map<string, string>()

  beforeAll(async () => {
    matchService = new MatchService()
    // roomManager = new RoomManager()
    // matchmaker = new Matchmaker()
    
    fastify = Fastify({ logger: false })
    await fastify.register(cors, { origin: true })
    await fastify.register(fastifySocketIO, {
      cors: { origin: true }
    })

    const gameNamespace = fastify.io.of('/game')
    
    gameNamespace.on('connection', (socket: any) => {
      // Assign player IDs based on connection order
      const connectionCount = playerIdMapping.size
      const playerId = connectionCount === 0 ? 'player1' : 'player2'
      playerIdMapping.set(socket.id, playerId)

      socket.on('claimSquare', async (data: any) => {
        const { matchId, squareId, selectionId } = data
        const mappedPlayerId = playerIdMapping.get(socket.id) || playerId
        
        const result = await matchService.claimSquare({
          matchId,
          squareId,
          selectionId,
          playerId: mappedPlayerId
        })

        if (result.success && result.move && result.matchState) {
          // Broadcast to all clients
          gameNamespace.emit('squareClaimed', {
            matchId,
            move: result.move,
            matchState: result.matchState,
            version: result.matchState.version
          })

          if (result.matchState.status === 'finished') {
            gameNamespace.emit('gameResult', {
              matchId,
              winner: result.matchState.winner,
              winningLine: result.matchState.winningLine
            })
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

    await fastify.listen({ port: 0 })
    const address = fastify.server.address()
    serverUrl = `http://localhost:${address.port}`
  })

  afterEach(() => {
    clients.forEach(client => client.disconnect())
    clients.length = 0
    playerIdMapping.clear()
  })

  afterAll(async () => {
    await fastify.close()
    matchService = null as any
    // roomManager = null as any
    // matchmaker = null as any
  })

  test('Race condition - two players claim same square simultaneously', async () => {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Test timeout'))
      }, 5000)

      const matchState = matchService.createMatch('room1', ['player1', 'player2'])
      const matchId = matchState.id

      const client1 = io(`${serverUrl}/game`, { autoConnect: true })
      const client2 = io(`${serverUrl}/game`, { autoConnect: true })
      clients.push(client1, client2)

      let claimsReceived = 0
      let rejectionsReceived = 0
      let claimedBy: string | null = null

      client1.on('squareClaimed', (data) => {
        claimsReceived++
        claimedBy = data.move.playerId
        console.log(`Square claimed by ${data.move.playerId}`)
      })

      client2.on('squareClaimed', (data) => {
        claimsReceived++
        if (!claimedBy) claimedBy = data.move.playerId
      })

      client1.on('claimRejected', (data) => {
        rejectionsReceived++
        console.log(`Claim rejected for ${client1.id}: ${data.reason}`)
      })

      client2.on('claimRejected', (data) => {
        rejectionsReceived++
        console.log(`Claim rejected for ${client2.id}: ${data.reason}`)
      })

      // Wait for both clients to connect
      let connectedClients = 0
      const checkBothConnected = () => {
        connectedClients++
        if (connectedClients === 2) {
          // Both clients try to claim the same square (square 0) simultaneously
          // with a small random delay to simulate real race conditions
          const delay1 = Math.random() * 10
          const delay2 = Math.random() * 10

          setTimeout(() => {
            client1.emit('claimSquare', {
              matchId,
              squareId: 0,
              selectionId: 'race-client1-sq0'
            })
          }, delay1)

          setTimeout(() => {
            client2.emit('claimSquare', {
              matchId,
              squareId: 0,
              selectionId: 'race-client2-sq0'
            })
          }, delay2)

          // Check results after a short delay
          setTimeout(() => {
            try {
              console.log(`Claims received: ${claimsReceived}, Rejections: ${rejectionsReceived}`)
              
              // Exactly one claim should succeed, one should be rejected
              expect(claimsReceived).toBe(2) // Both clients receive the successful claim
              expect(rejectionsReceived).toBe(1) // One client receives rejection
              expect(claimedBy).toBeTruthy()
              
              // Verify the match state
              const match = matchService.getMatch(matchId)
              const expectedSeat = claimedBy === 'player1' ? 'P1' : 'P2'
              expect(match?.board[0]).toBe(expectedSeat)
              expect(match?.moves).toHaveLength(1)
              expect(match?.moves[0].playerId).toBe(claimedBy)
              
              clearTimeout(timeout)
              resolve()
            } catch (error) {
              clearTimeout(timeout)
              reject(error)
            }
          }, 500)
        }
      }

      client1.on('connect', checkBothConnected)
      client2.on('connect', checkBothConnected)
    })
  })

  test('Idempotency - duplicate selectionId rejected', async () => {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Test timeout'))
      }, 5000)

      const matchState = matchService.createMatch('room2', ['player1', 'player2'])
      const matchId = matchState.id

      const client1 = io(`${serverUrl}/game`, { autoConnect: true })
      clients.push(client1)

      let claimsReceived = 0
      let rejectionsReceived = 0

      client1.on('squareClaimed', () => {
        claimsReceived++
      })

      client1.on('claimRejected', (data) => {
        rejectionsReceived++
        expect(data.reason).toBe('duplicate_selection')
      })

      client1.on('connect', () => {
        // Make the same claim twice with identical selectionId
        const duplicateSelection = 'duplicate-test-123'
        
        client1.emit('claimSquare', {
          matchId,
          squareId: 4, // Center square
          selectionId: duplicateSelection
        })

        // Small delay then try again with same selectionId
        setTimeout(() => {
          client1.emit('claimSquare', {
            matchId,
            squareId: 5, // Different square, same selectionId
            selectionId: duplicateSelection
          })

          // Check results
          setTimeout(() => {
            try {
              expect(claimsReceived).toBe(1) // Only first claim succeeds
              expect(rejectionsReceived).toBe(1) // Second claim rejected
              
              const match = matchService.getMatch(matchId)
              expect(match?.moves).toHaveLength(1)
              expect(match?.board[4]).toBeTruthy()
              expect(match?.board[5]).toBeNull()
              
              clearTimeout(timeout)
              resolve()
            } catch (error) {
              clearTimeout(timeout)
              reject(error)
            }
          }, 200)
        }, 50)
      })
    })
  })

  test('Version consistency during concurrent updates', async () => {
    if (skipIfNotMode('turn', 'Version consistency during concurrent updates')) {
      return
    }

    const matchState = matchService.createMatch('room3', ['player1', 'player2'])
    const matchId = matchState.id

    const client1 = io(`${serverUrl}/game`, { autoConnect: true })
    const client2 = io(`${serverUrl}/game`, { autoConnect: true })
    clients.push(client1, client2)

    // Wait for both clients to connect
    await Promise.all([
      waitForSocketEvent(client1, 'connect'),
      waitForSocketEvent(client2, 'connect')
    ])

    // Set up to wait for all 8 squareClaimed events (4 moves × 2 clients each)
    const eventPromise = waitForMultipleSocketEvents([
      { socket: client1, eventName: 'squareClaimed', count: 4 },
      { socket: client2, eventName: 'squareClaimed', count: 4 }
    ], { timeoutMs: 5000 })

    // Make 4 alternating moves to test version consistency
    const moves = [
      { square: 0, player: 'player1', delay: 10 },
      { square: 1, player: 'player2', delay: 60 },
      { square: 2, player: 'player1', delay: 110 },
      { square: 3, player: 'player2', delay: 160 }
    ]

    moves.forEach((move, index) => {
      setTimeout(() => {
        const client = move.player === 'player1' ? client1 : client2
        client.emit('claimSquare', {
          matchId,
          squareId: move.square,
          selectionId: `move-${index}`
        })
      }, move.delay)
    })

    const [client1Events, client2Events] = await eventPromise

    // Collect all received versions
    const allVersions = [...client1Events, ...client2Events].map(event => event.version)
    
    // Versions should be sequential: 1, 1, 2, 2, 3, 3, 4, 4
    const uniqueVersions = [...new Set(allVersions)].sort((a, b) => a - b)
    expect(uniqueVersions).toEqual([1, 2, 3, 4])
    
    // Each version should appear exactly twice (once per client)
    for (const version of uniqueVersions) {
      const count = allVersions.filter(v => v === version).length
      expect(count).toBe(2)
    }
  })

  test('Game result broadcast on win condition', async () => {
    if (skipIfNotMode('turn', 'Game result broadcast on win condition')) {
      return
    }

    const matchState = matchService.createMatch('room4', ['player1', 'player2'])
    const matchId = matchState.id

    const client1 = io(`${serverUrl}/game`, { autoConnect: true })
    const client2 = io(`${serverUrl}/game`, { autoConnect: true })
    clients.push(client1, client2)

    // Wait for both clients to connect
    await Promise.all([
      waitForSocketEvent(client1, 'connect'),
      waitForSocketEvent(client2, 'connect')
    ])

    // Set up to wait for gameResult events on both clients
    const gameResultPromise = waitForMultipleSocketEvents([
      { socket: client1, eventName: 'gameResult', count: 1 },
      { socket: client2, eventName: 'gameResult', count: 1 }
    ], { timeoutMs: 5000 })

    // Create a winning sequence for player1 (top row)
    const winningMoves = [
      { square: 0, client: client1, delay: 10 },   // player1
      { square: 3, client: client2, delay: 60 },   // player2  
      { square: 1, client: client1, delay: 110 },  // player1
      { square: 4, client: client2, delay: 160 },  // player2
      { square: 2, client: client1, delay: 210 }   // player1 wins
    ]

    winningMoves.forEach((move, index) => {
      setTimeout(() => {
        move.client.emit('claimSquare', {
          matchId,
          squareId: move.square,
          selectionId: `win-move-${index}`
        })
      }, move.delay)
    })

    const [client1Results, client2Results] = await gameResultPromise

    // Both clients should receive the same game result
    const result1 = client1Results[0]
    const result2 = client2Results[0]

    expect(result1.matchId).toBe(matchId)
    expect(result1.winner).toBe('P1') // Engine returns seat, not playerId
    expect(result1.winningLine).toEqual([0, 1, 2]) // Top row

    expect(result2.matchId).toBe(matchId)
    expect(result2.winner).toBe('P1')
    expect(result2.winningLine).toEqual([0, 1, 2])
  })
})