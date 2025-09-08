import { describe, test, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { io, Socket } from 'socket.io-client'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import fastifySocketIO from 'fastify-socket.io'
import { MatchService } from '../services/matchService.js'

describe('Match Integration Tests - Race Conditions', () => {
  let fastify: any
  let serverUrl: string
  let matchService: MatchService
  // Unused but required for future expansion
  // let roomManager: RoomManager  
  // let matchmaker: Matchmaker
  const clients: Socket[] = []

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
      const playerId = socket.id

      socket.on('claimSquare', async (data: any) => {
        const { matchId, squareId, selectionId } = data
        
        const result = await matchService.claimSquare({
          matchId,
          squareId,
          selectionId,
          playerId
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
              expect(match?.board[0]).toBe(claimedBy)
              expect(match?.moves).toHaveLength(1)
              
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
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Test timeout'))
      }, 10000)

      const matchState = matchService.createMatch('room3', ['player1', 'player2'])
      const matchId = matchState.id

      const client1 = io(`${serverUrl}/game`, { autoConnect: true })
      const client2 = io(`${serverUrl}/game`, { autoConnect: true })
      clients.push(client1, client2)

      const receivedVersions: number[] = []
      let moveCount = 0

      const checkMove = (data: any) => {
        receivedVersions.push(data.version)
        moveCount++
        
        // After 4 moves, check version consistency
        if (moveCount === 8) { // 4 moves × 2 clients receiving each = 8 events
          try {
            // Versions should be sequential: 1, 1, 2, 2, 3, 3, 4, 4
            const uniqueVersions = [...new Set(receivedVersions)].sort((a, b) => a - b)
            expect(uniqueVersions).toEqual([1, 2, 3, 4])
            
            // Each version should appear exactly twice (once per client)
            for (const version of uniqueVersions) {
              const count = receivedVersions.filter(v => v === version).length
              expect(count).toBe(2)
            }
            
            clearTimeout(timeout)
            resolve()
          } catch (error) {
            clearTimeout(timeout)
            reject(error)
          }
        }
      }

      client1.on('squareClaimed', checkMove)
      client2.on('squareClaimed', checkMove)

      let connectedClients = 0
      const checkBothConnected = () => {
        connectedClients++
        if (connectedClients === 2) {
          // Make 4 alternating moves to test version consistency
          const moves = [
            { square: 0, player: 'player1', delay: 0 },
            { square: 1, player: 'player2', delay: 50 },
            { square: 2, player: 'player1', delay: 100 },
            { square: 3, player: 'player2', delay: 150 }
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
        }
      }

      client1.on('connect', checkBothConnected)
      client2.on('connect', checkBothConnected)
    })
  })

  test('Game result broadcast on win condition', async () => {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Test timeout'))
      }, 5000)

      const matchState = matchService.createMatch('room4', ['player1', 'player2'])
      const matchId = matchState.id

      const client1 = io(`${serverUrl}/game`, { autoConnect: true })
      const client2 = io(`${serverUrl}/game`, { autoConnect: true })
      clients.push(client1, client2)

      let gameResultsReceived = 0

      const checkGameResult = (data: any) => {
        gameResultsReceived++
        expect(data.matchId).toBe(matchId)
        expect(data.winner).toBe('player1')
        expect(data.winningLine).toEqual([0, 1, 2]) // Top row
        
        if (gameResultsReceived === 2) { // Both clients should receive
          clearTimeout(timeout)
          resolve()
        }
      }

      client1.on('gameResult', checkGameResult)
      client2.on('gameResult', checkGameResult)

      let connectedClients = 0
      const checkBothConnected = () => {
        connectedClients++
        if (connectedClients === 2) {
          // Create a winning sequence for player1 (top row)
          const winningMoves = [
            { square: 0, client: client1, delay: 0 },   // player1
            { square: 3, client: client2, delay: 50 },  // player2  
            { square: 1, client: client1, delay: 100 }, // player1
            { square: 4, client: client2, delay: 150 }, // player2
            { square: 2, client: client1, delay: 200 }  // player1 wins
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
        }
      }

      client1.on('connect', checkBothConnected)
      client2.on('connect', checkBothConnected)
    })
  })
})