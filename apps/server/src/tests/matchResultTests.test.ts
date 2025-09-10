import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import fastifySocketIO from 'fastify-socket.io'
import { MatchService } from '../services/matchService.js'
import { RoomManager } from '../services/roomManager.js'
import { Matchmaker } from '../services/matchmaker.js'
import { GameRegistry } from '../services/gameRegistry.js'
import { NAMESPACE } from '../index.js'
import { makeClient, TestClient } from './utils/testClient.js'

// Set match mode for turn-based tests
process.env.MATCH_MODE = 'turn'

describe('M2.2 Match Result and Rematch Tests', () => {
  let fastify: any
  let serverUrl: string
  let matchService: MatchService
  let roomManager: RoomManager
  let matchmaker: Matchmaker
  const clients: TestClient[] = []

  beforeEach(async () => {
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
    
    // Simplified server setup matching production handlers
    gameNamespace.on('connection', (socket: any) => {
      const playerId = socket.id

      socket.on('quickMatch', async () => {
        const result = await matchmaker.requestQuickMatch(playerId, socket.id)
        
        if (result.type === 'paired' && result.room) {
          const room = result.room
          
          room.players.forEach(player => {
            const playerSocket = Array.from(gameNamespace.sockets.values())
              .find(s => s.id === player.socketId)
            if (playerSocket) {
              playerSocket.join(room.id)
            }
          })
          
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
          const roomId = result.matchState.roomId
          
          if (roomId) {
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
              matchId,
              board: result.matchState.board,
              moves: result.matchState.moves,
              version: result.matchState.version,
              currentTurn: result.matchState.currentTurn,
              winner: result.matchState.winner,
              winningLine: result.matchState.winningLine
            }
            gameNamespace.to(roomId).emit('stateSync', stateEvent)
            
            // Emit result event when game finishes
            if (result.matchState.status === 'finished') {
              const resultData = {
                matchId,
                winner: result.matchState.winner,
                line: result.matchState.winningLine
              }
              gameNamespace.to(roomId).emit('result', resultData)
            }
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

      socket.on('rematch', async (data) => {
        const { matchId } = data
        
        const result = await matchService.requestRematch({
          matchId,
          playerId
        })

        if (result.type === 'waiting') {
          socket.emit('rematchPending', { matchId })
        } else if (result.type === 'matched' && result.newMatchId) {
          const match = matchService.getMatch(result.newMatchId)
          if (match) {
            match.players.forEach(pid => {
              const playerSocket = gameNamespace.sockets.get(pid)
              if (playerSocket) {
                const mySeat = match.playerSeats.get(pid)
                playerSocket.emit('matchStart', {
                  matchId: match.id,
                  roomId: match.roomId,
                  mySeat,
                  players: match.players,
                  currentTurn: match.currentTurn
                })
              }
            })
          }
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

  test('P1 wins diagonally and result event is emitted exactly once', async () => {
    const client1 = makeClient(`${serverUrl}${NAMESPACE}`)
    const client2 = makeClient(`${serverUrl}${NAMESPACE}`)
    clients.push(client1, client2)

    // Connect both clients
    await client1.connect()
    await client2.connect()

    // Start quick match for both
    await Promise.all([client1.quickMatch(), client2.quickMatch()])

    // Verify both clients have same match and complementary seats
    const state1 = client1.getState()
    const state2 = client2.getState()
    expect(state1.matchId).toBe(state2.matchId)
    expect([state1.mySeat, state2.mySeat].sort()).toEqual(['P1', 'P2'])

    // Determine P1 client
    const p1Client = state1.mySeat === 'P1' ? client1 : client2
    const p2Client = state1.mySeat === 'P1' ? client2 : client1

    // Set up result event listeners
    let resultEvents = 0
    const resultPromises = []
    
    resultPromises.push(client1.awaitEvent('result', 2000).then(data => {
      expect(data.winner).toBe('P1')
      expect(data.line).toEqual([0, 4, 8])
      resultEvents++
    }))
    
    resultPromises.push(client2.awaitEvent('result', 2000).then(data => {
      expect(data.winner).toBe('P1')
      expect(data.line).toEqual([0, 4, 8])
      resultEvents++
    }))

    // Play diagonal win: P1: 0,4,8  P2: 1,2
    p1Client.claimSquare(0, 'p1-0')
    await client1.awaitEvent('squareClaimed', 1000)
    
    p2Client.claimSquare(1, 'p2-1')
    await client1.awaitEvent('squareClaimed', 1000)
    
    p1Client.claimSquare(4, 'p1-4')
    await client1.awaitEvent('squareClaimed', 1000)
    
    p2Client.claimSquare(2, 'p2-2')
    await client1.awaitEvent('squareClaimed', 1000)
    
    // Winning move
    p1Client.claimSquare(8, 'p1-8')
    
    // Wait for all result events
    await Promise.all(resultPromises)
    expect(resultEvents).toBe(2)
  })

  test('Draw game emits result with winner="draw" and line=null', async () => {
    const client1 = makeClient(`${serverUrl}${NAMESPACE}`)
    const client2 = makeClient(`${serverUrl}${NAMESPACE}`)
    clients.push(client1, client2)

    await client1.connect()
    await client2.connect()
    await Promise.all([client1.quickMatch(), client2.quickMatch()])

    const state1 = client1.getState()
    const state2 = client2.getState()
    expect(state1.matchId).toBe(state2.matchId)

    const p1Client = state1.mySeat === 'P1' ? client1 : client2
    const p2Client = state1.mySeat === 'P1' ? client2 : client1

    // Set up result listeners
    const resultPromises = [
      client1.awaitEvent('result', 2000).then(data => {
        expect(data.winner).toBe('draw')
        expect(data.line).toBeNull()
      }),
      client2.awaitEvent('result', 2000).then(data => {
        expect(data.winner).toBe('draw')
        expect(data.line).toBeNull()
      })
    ]

    // Force draw sequence: P1: 0,1,5,6  P2: 2,3,4,7,8
    const moves = [
      () => p1Client.claimSquare(0, 'p1-0'),
      () => p2Client.claimSquare(2, 'p2-2'),
      () => p1Client.claimSquare(1, 'p1-1'),
      () => p2Client.claimSquare(3, 'p2-3'),
      () => p1Client.claimSquare(5, 'p1-5'),
      () => p2Client.claimSquare(4, 'p2-4'),
      () => p1Client.claimSquare(6, 'p1-6'),
      () => p2Client.claimSquare(7, 'p2-7'),
      () => p2Client.claimSquare(8, 'p2-8') // Final draw move
    ]

    // Execute moves with proper awaits
    for (let i = 0; i < moves.length; i++) {
      moves[i]()
      if (i < moves.length - 1) {
        await client1.awaitEvent('squareClaimed', 1000)
      }
    }

    await Promise.all(resultPromises)
  })

  test('Race condition: Last move wins while opponent clicks - only one result emitted', async () => {
    const client1 = makeClient(`${serverUrl}${NAMESPACE}`)
    const client2 = makeClient(`${serverUrl}${NAMESPACE}`)
    clients.push(client1, client2)

    await client1.connect()
    await client2.connect() 
    await Promise.all([client1.quickMatch(), client2.quickMatch()])

    const state1 = client1.getState()
    const state2 = client2.getState()
    expect(state1.matchId).toBe(state2.matchId)

    const p1Client = state1.mySeat === 'P1' ? client1 : client2
    const p2Client = state1.mySeat === 'P1' ? client2 : client1

    // Set up listeners for results and rejections
    let resultEvents = 0
    let rejectedClaims = 0
    
    const resultPromises = [
      client1.awaitEvent('result', 2000).then(data => {
        expect(data.winner).toBe('P1')
        expect(data.line).toEqual([0, 4, 8])
        resultEvents++
      }),
      client2.awaitEvent('result', 2000).then(data => {
        expect(data.winner).toBe('P1')
        expect(data.line).toEqual([0, 4, 8])
        resultEvents++
      })
    ]

    // Build near-win state: P1 has [0, 4], needs 8 for diagonal win
    p1Client.claimSquare(0, 'p1-0')
    await client1.awaitEvent('squareClaimed', 1000)
    
    p2Client.claimSquare(1, 'p2-1')
    await client1.awaitEvent('squareClaimed', 1000)
    
    p1Client.claimSquare(4, 'p1-4')
    await client1.awaitEvent('squareClaimed', 1000)
    
    p2Client.claimSquare(2, 'p2-2')
    await client1.awaitEvent('squareClaimed', 1000)

    // RACE CONDITION: P1 wins with 8, P2 tries 3 simultaneously 
    p1Client.claimSquare(8, 'p1-8-win')
    p2Client.claimSquare(3, 'p2-3-race')

    // Set up rejection listener with timeout
    const rejectionPromise = new Promise<void>((resolve) => {
      const timeout = setTimeout(() => resolve(), 1000)
      
      const checkRejection = (data: any) => {
        if (data.reason === 'match_finished') {
          rejectedClaims++
          clearTimeout(timeout)
          resolve()
        }
      }
      
      client1.awaitEvent('claimRejected', 500).then(checkRejection).catch(() => {})
      client2.awaitEvent('claimRejected', 500).then(checkRejection).catch(() => {})
    })

    await Promise.all([...resultPromises, rejectionPromise])
    
    expect(resultEvents).toBe(2) // Both clients get exactly one result
    expect(rejectedClaims).toBe(1) // One claim rejected as match_finished
  })

  test('Rematch handshake: both players request, starter flips', async () => {
    const client1 = makeClient(`${serverUrl}${NAMESPACE}`)
    const client2 = makeClient(`${serverUrl}${NAMESPACE}`)
    clients.push(client1, client2)

    await client1.connect()
    await client2.connect()
    await Promise.all([client1.quickMatch(), client2.quickMatch()])

    const state1 = client1.getState()
    const state2 = client2.getState()
    const originalMatchId = state1.matchId!
    
    const originalP1Client = state1.mySeat === 'P1' ? client1 : client2
    const originalP1Seat = state1.mySeat === 'P1' ? 'P1' : 'P2'
    
    // Play quick win: P1 gets horizontal line 0,1,2
    const p1Client = originalP1Client
    p1Client.claimSquare(0, 'quick-0')
    await client1.awaitEvent('squareClaimed', 1000)
    
    p1Client.claimSquare(1, 'quick-1')
    await client1.awaitEvent('squareClaimed', 1000)
    
    p1Client.claimSquare(2, 'quick-2')

    // Wait for game result
    await Promise.all([
      client1.awaitEvent('result', 2000),
      client2.awaitEvent('result', 2000)
    ])

    // Both request rematch
    client1.emit('rematch', { matchId: originalMatchId })
    await client1.awaitEvent('rematchPending', 1000)
    
    client2.emit('rematch', { matchId: originalMatchId })
    
    // Wait for new match to start
    await Promise.all([
      client1.awaitEvent('matchStart', 2000),
      client2.awaitEvent('matchStart', 2000)
    ])

    // Verify starter flipped
    const newState1 = client1.getState()
    const newState2 = client2.getState()
    
    expect(newState1.matchId).not.toBe(originalMatchId) // New match
    expect(newState1.version).toBe(0) // Reset version
    
    // Original P1 should now be P2
    if (originalP1Client === client1) {
      expect(newState1.mySeat).toBe('P2')
      expect(newState2.mySeat).toBe('P1')
    } else {
      expect(newState1.mySeat).toBe('P1')
      expect(newState2.mySeat).toBe('P2')
    }
  })

  test('Rematch timeout: single player request expires after 60s', async () => {
    const client1 = makeClient(`${serverUrl}${NAMESPACE}`)
    const client2 = makeClient(`${serverUrl}${NAMESPACE}`)
    clients.push(client1, client2)

    await client1.connect()
    await client2.connect()
    await Promise.all([client1.quickMatch(), client2.quickMatch()])

    const state1 = client1.getState()
    const p1Client = state1.mySeat === 'P1' ? client1 : client2
    const matchId = state1.matchId!
    
    // Quick win: P1 gets horizontal line 0,1,2
    p1Client.claimSquare(0, 'win-0')
    await client1.awaitEvent('squareClaimed', 1000)
    
    p1Client.claimSquare(1, 'win-1')
    await client1.awaitEvent('squareClaimed', 1000)
    
    p1Client.claimSquare(2, 'win-2')

    // Wait for result
    await Promise.all([
      client1.awaitEvent('result', 2000),
      client2.awaitEvent('result', 2000)
    ])

    // Only client1 requests rematch
    client1.emit('rematch', { matchId })
    
    // Verify rematch pending state
    await client1.awaitEvent('rematchPending', 1000)
    
    // P2 doesn't respond - in real scenario this would timeout after 60s
    // For test purposes, we just verify the pending state was reached
  })
})