import { test, expect, describe, beforeAll, afterAll, beforeEach } from 'vitest'
import Fastify, { FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import fastifySocketIO from 'fastify-socket.io'
import { io as ioc, Socket as ClientSocket } from 'socket.io-client'
import { RoomManager } from '../services/roomManager.js'
import { Matchmaker } from '../services/matchmaker.js'
import { MatchService } from '../services/matchService.js'

describe('Room Integration Tests', () => {
  let server: FastifyInstance
  let serverURL: string
  const connectedSockets: ClientSocket[] = []

  beforeAll(async () => {
    // Import and set up room manager similar to main server
    const { RoomManager } = await import('../services/roomManager.js')
    const roomManager = new RoomManager()

    server = Fastify({ logger: false })
    
    await server.register(cors, {
      origin: true,
      methods: ['GET', 'POST'],
    })

    await server.register(fastifySocketIO, {
      cors: {
        origin: true,
        methods: ['GET', 'POST'],
      }
    })

    const gameNamespace = server.io.of('/game')

    // Set up room event handlers (simplified version of main server)
    gameNamespace.on('connection', (socket) => {
      const playerId = socket.id

      socket.on('quickMatch', () => {
        const result = roomManager.quickMatch(playerId, socket.id)
        
        if (result === 'queued') {
          console.log(`Player ${playerId} added to quick match queue`)
        } else {
          const room = result
          const update = roomManager.createRoomUpdate(room, 'player_joined')
          
          // Both players join the room
          room.players.forEach(player => {
            const playerSocket = Array.from(gameNamespace.sockets.values())
              .find(s => s.id === player.socketId)
            if (playerSocket) {
              playerSocket.join(room.id)
            }
          })
          
          gameNamespace.to(room.id).emit('roomUpdate', update)
          gameNamespace.to(room.id).emit('quickMatchFound', update.room)
          
          if (room.status === 'active') {
            const match = {
              roomId: room.id,
              players: room.players,
              startedAt: new Date()
            }
            gameNamespace.to(room.id).emit('matchStart', match)
          }
        }
      })

      socket.on('createRoom', (isPublic = false) => {
        const room = roomManager.createRoom(playerId, socket.id, isPublic)
        socket.join(room.id)
        
        const update = roomManager.createRoomUpdate(room, 'player_joined')
        socket.emit('roomJoined', update.room)
      })

      socket.on('joinRoom', (code: string) => {
        const room = roomManager.joinRoom(playerId, socket.id, code)
        if (room) {
          socket.join(room.id)
          const update = roomManager.createRoomUpdate(room, 'player_joined')
          
          gameNamespace.to(room.id).emit('roomUpdate', update)
          socket.emit('roomJoined', update.room)
          
          if (room.status === 'active') {
            const match = {
              roomId: room.id,
              players: room.players,
              startedAt: new Date()
            }
            gameNamespace.to(room.id).emit('matchStart', match)
          }
        } else {
          socket.emit('error', 'Room not found, full, or already active')
        }
      })

      socket.on('getPublicRooms', () => {
        const rooms = roomManager.getPublicRooms()
        const roomUpdates = rooms.map(room => 
          roomManager.createRoomUpdate(room, 'status_changed').room
        )
        socket.emit('publicRooms', roomUpdates)
      })

      socket.on('disconnect', () => {
        roomManager.leaveRoom(playerId)
      })
    })

    await server.ready()
    await server.listen({ port: 0, host: '127.0.0.1' })
    
    const address = server.server.address()
    if (address && typeof address === 'object') {
      serverURL = `http://127.0.0.1:${address.port}`
    } else {
      throw new Error('Unable to get server address')
    }
  })

  afterAll(async () => {
    for (const socket of connectedSockets) {
      if (socket.connected) {
        socket.disconnect()
      }
    }
    connectedSockets.length = 0
    await server.close()
  })

  beforeEach(() => {
    // Clear any existing connections between tests
    connectedSockets.forEach(socket => {
      if (socket.connected) {
        socket.disconnect()
      }
    })
    connectedSockets.length = 0
  })

  const createConnection = (): Promise<ClientSocket> => {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'))
      }, 5000)

      const client = ioc(`${serverURL}/game`, {
        forceNew: true,
        autoConnect: true,
        transports: ['websocket', 'polling'],
      })

      connectedSockets.push(client)

      client.on('connect', () => {
        clearTimeout(timeout)
        resolve(client)
      })

      client.on('connect_error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
    })
  }

  test('Quick Match - two players should be matched and receive matchStart', async () => {
    const client1 = await createConnection()
    const client2 = await createConnection()

    let client1MatchFound = false
    let client2MatchFound = false
    let client1MatchStarted = false
    let client2MatchStarted = false

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Test timeout'))
      }, 8000)

      client1.on('quickMatchFound', (room) => {
        client1MatchFound = true
        expect(room).toBeTruthy()
        expect(room.players).toHaveLength(2)
        expect(room.status).toBe('active')
      })

      client2.on('quickMatchFound', (room) => {
        client2MatchFound = true
        expect(room).toBeTruthy()
        expect(room.players).toHaveLength(2)
        expect(room.status).toBe('active')
      })

      client1.on('matchStart', (match) => {
        client1MatchStarted = true
        expect(match).toBeTruthy()
        expect(match.players).toHaveLength(2)
        checkComplete()
      })

      client2.on('matchStart', (match) => {
        client2MatchStarted = true
        expect(match).toBeTruthy()
        expect(match.players).toHaveLength(2)
        checkComplete()
      })

      const checkComplete = () => {
        if (client1MatchFound && client2MatchFound && client1MatchStarted && client2MatchStarted) {
          clearTimeout(timeout)
          resolve()
        }
      }

      client1.on('error', reject)
      client2.on('error', reject)

      // Start quick match for both players
      client1.emit('quickMatch')
      client2.emit('quickMatch')
    })
  }, 10000)

  test('Room Creation and Joining', async () => {
    const client1 = await createConnection()
    const client2 = await createConnection()

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Test timeout'))
      }, 8000)

      let roomCode: string
      let client1Joined = false
      let client2Joined = false
      let matchStartReceived = false

      client1.on('roomJoined', (room) => {
        client1Joined = true
        roomCode = room.code
        expect(room).toBeTruthy()
        expect(room.players).toHaveLength(1)
        expect(room.status).toBe('waiting')
        
        // Have client2 join the room
        client2.emit('joinRoom', roomCode)
      })

      client2.on('roomJoined', (room) => {
        client2Joined = true
        expect(room).toBeTruthy()
        expect(room.players).toHaveLength(2)
        expect(room.status).toBe('active') // Should auto-start when full
      })

      const checkMatchStart = (match: any) => {
        matchStartReceived = true
        expect(match).toBeTruthy()
        expect(match.players).toHaveLength(2)
        
        if (client1Joined && client2Joined && matchStartReceived) {
          clearTimeout(timeout)
          resolve()
        }
      }

      client1.on('matchStart', checkMatchStart)
      client2.on('matchStart', checkMatchStart)

      client1.on('error', reject)
      client2.on('error', reject)

      // Create a room with client1
      client1.emit('createRoom', false) // Private room
    })
  }, 10000)

  test('Room capacity enforcement', async () => {
    const client1 = await createConnection()
    const client2 = await createConnection()
    const client3 = await createConnection()

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Test timeout'))
      }, 8000)

      let roomCode: string

      client1.on('roomJoined', (room) => {
        roomCode = room.code
        // Have client2 join
        client2.emit('joinRoom', roomCode)
      })

      client2.on('roomJoined', (room) => {
        expect(room.players).toHaveLength(2)
        // Have client3 try to join (should fail)
        client3.emit('joinRoom', roomCode)
      })

      client3.on('error', (message) => {
        expect(message).toBe('Room not found, full, or already active')
        clearTimeout(timeout)
        resolve()
      })

      client1.on('error', reject)
      client2.on('error', reject)

      // Create a room
      client1.emit('createRoom', false)
    })
  }, 10000)

  test('Public rooms listing', async () => {
    const client1 = await createConnection()
    const client2 = await createConnection()

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Test timeout'))
      }, 8000)

      client1.on('roomJoined', () => {
        // Create another public room
        client2.emit('createRoom', true)
      })

      client2.on('roomJoined', () => {
        // Get public rooms
        client2.emit('getPublicRooms')
      })

      client2.on('publicRooms', (rooms) => {
        expect(rooms).toHaveLength(2) // Both public rooms should be listed
        expect(rooms.every((room: any) => room.isPublic)).toBe(true)
        expect(rooms.every((room: any) => room.status === 'waiting')).toBe(true)
        
        clearTimeout(timeout)
        resolve()
      })

      client1.on('error', reject)
      client2.on('error', reject)

      // Create first public room
      client1.emit('createRoom', true)
    })
  }, 10000)

  test('Room updates on player join/leave', async () => {
    const client1 = await createConnection()
    const client2 = await createConnection()

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Test timeout'))
      }, 8000)

      let roomCode: string
      let roomUpdateReceived = false

      client1.on('roomJoined', (room) => {
        roomCode = room.code
        client2.emit('joinRoom', roomCode)
      })

      client1.on('roomUpdate', (update) => {
        expect(update.type).toBe('player_joined')
        expect(update.room.players).toHaveLength(2)
        roomUpdateReceived = true
      })

      client1.on('matchStart', () => {
        if (roomUpdateReceived) {
          clearTimeout(timeout)
          resolve()
        }
      })

      client1.on('error', reject)
      client2.on('error', reject)

      client1.emit('createRoom', false)
    })
  }, 10000)

  test('Join non-existent room should fail', async () => {
    const client = await createConnection()

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Test timeout'))
      }, 5000)

      client.on('error', (message) => {
        expect(message).toBe('Room not found, full, or already active')
        clearTimeout(timeout)
        resolve()
      })

      client.emit('joinRoom', 'ROOM-INVALID')
    })
  }, 8000)
})

describe('Cross-Client Propagation Tests', () => {
  let server: FastifyInstance
  let serverURL: string
  let roomManager: RoomManager
  let matchmaker: Matchmaker
  let matchService: MatchService
  const connectedSockets: ClientSocket[] = []

  beforeAll(async () => {
    // Create service instances
    roomManager = new RoomManager()
    matchmaker = new Matchmaker()
    matchService = new MatchService()

    server = Fastify({ logger: false })
    
    await server.register(cors, {
      origin: true,
      methods: ['GET', 'POST'],
    })

    await server.register(fastifySocketIO, {
      cors: { origin: true, methods: ['GET', 'POST'] }
    })

    const gameNamespace = server.io.of('/game')

    // Helper function to emit matchStart with seat information
    function emitMatchStartWithSeats(roomId: string, match: any, matchState: any) {
      if (matchState.playerSeats) {
        Array.from(gameNamespace.sockets.values()).forEach(socket => {
          const playerId = socket.id
          const mySeat = matchState.playerSeats.get(playerId)
          
          if (mySeat) {
            socket.emit('matchStart', {
              ...match,
              mySeat,
              currentTurn: matchState.currentTurn
            })
          }
        })
      }
    }

    // Socket handlers with full claimSquare logic
    gameNamespace.on('connection', (socket: any) => {
      const playerId = socket.id

      socket.on('quickMatch', async () => {
        const result = await matchmaker.requestQuickMatch(playerId, socket.id)
        
        if (result.type === 'paired' && result.room) {
          const room = result.room
          
          // Both players need to join the Socket.IO room
          room.players.forEach(player => {
            const playerSocket = Array.from(gameNamespace.sockets.values())
              .find((s: any) => s.id === player.socketId)
            
            if (playerSocket) {
              playerSocket.join(room.id)
            }
          })
          
          // Start the match
          const match = {
            roomId: room.id,
            players: room.players,
            startedAt: new Date()
          }
          
          const matchState = matchService.createMatch(room.id, room.players.map(p => p.id))
          roomManager.setMatchRoom(matchState.id, room.id)
          
          emitMatchStartWithSeats(room.id, match, matchState)
        }
      })

      socket.on('claimSquare', async (data: any) => {
        const { matchId, squareId, selectionId } = data
        
        const result = await matchService.claimSquare({
          matchId,
          squareId,
          selectionId,
          playerId
        })

        if (result.success && result.move && result.matchState) {
          const room = roomManager.getRoomByMatchId(matchId)
          if (room) {
            // Ensure socket is in the room
            if (!socket.rooms.has(room.id)) {
              socket.join(room.id)
            }

            const playerSeat = result.matchState.playerSeats?.get(playerId)
            
            // Emit squareClaimed with exact spec payload
            const claimEvent = {
              matchId,
              squareId,
              by: playerSeat,
              version: result.matchState.version,
              nextTurn: result.nextTurn
            }
            gameNamespace.to(room.id).emit('squareClaimed', claimEvent)
            
            // Emit stateSync for redundancy
            const stateEvent = {
              board: result.matchState.board,
              moves: result.matchState.moves,
              version: result.matchState.version,
              currentTurn: result.matchState.currentTurn,
              winner: result.matchState.winner
            }
            gameNamespace.to(room.id).emit('stateSync', stateEvent)
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

    await server.ready()
    await server.listen({ port: 0, host: '127.0.0.1' })
    
    const address = server.server.address()
    if (address && typeof address === 'object') {
      serverURL = `http://127.0.0.1:${address.port}`
    }
  })

  afterAll(async () => {
    connectedSockets.forEach(socket => socket?.disconnect())
    roomManager?.destroy()
    await server?.close()
  })

  beforeEach(() => {
    connectedSockets.forEach(socket => socket?.disconnect())
    connectedSockets.length = 0
  })

  const createConnection = (): Promise<ClientSocket> => {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000)
      const client = ioc(`${serverURL}/game`, { forceNew: true, autoConnect: true })
      connectedSockets.push(client)

      client.on('connect', () => {
        clearTimeout(timeout)
        resolve(client)
      })
      client.on('connect_error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
    })
  }

  test('P1 claims square -> both receive squareClaimed with nextTurn:P2 within 200ms', async () => {
    const socket1 = await createConnection()
    const socket2 = await createConnection()

    const events1: any[] = []
    const events2: any[] = []
    
    socket1.on('squareClaimed', (data) => events1.push({ ...data, timestamp: Date.now() }))
    socket2.on('squareClaimed', (data) => events2.push({ ...data, timestamp: Date.now() }))

    let matchId: string
    const startTime = Date.now()
    
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Test timeout')), 10000)
      
      socket1.on('matchStart', (data: any) => {
        matchId = data.roomId
        // P1 claims square 0
        socket1.emit('claimSquare', {
          matchId,
          squareId: 0,
          selectionId: 'test-claim-1'
        })
        
        setTimeout(() => {
          try {
            // Both received the claim
            expect(events1).toHaveLength(1)
            expect(events2).toHaveLength(1)
            
            // Verify payload structure
            expect(events1[0]).toMatchObject({
              matchId,
              squareId: 0,
              by: 'P1',
              nextTurn: 'P2',
              version: 1
            })
            
            expect(events2[0]).toMatchObject({
              matchId,
              squareId: 0,
              by: 'P1',
              nextTurn: 'P2',
              version: 1
            })
            
            // Verify timing (within 200ms)
            expect(events1[0].timestamp - startTime).toBeLessThan(200)
            expect(events2[0].timestamp - startTime).toBeLessThan(200)
            
            clearTimeout(timeout)
            resolve()
          } catch (error) {
            clearTimeout(timeout)
            reject(error)
          }
        }, 250)
      })
      
      // Start quick match
      socket1.emit('quickMatch')
      socket2.emit('quickMatch')
    })
  })

  test('P2 tries to move first -> claimRejected with not_your_turn', async () => {
    const socket1 = await createConnection()
    const socket2 = await createConnection()

    let rejected = false
    let rejectionReason: string | null = null
    
    socket2.on('claimRejected', (data) => {
      rejected = true
      rejectionReason = data.reason
    })

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Test timeout')), 8000)
      
      socket2.on('matchStart', (data: any) => {
        const matchId = data.roomId
        // P2 tries to claim square 0 (should be rejected)
        socket2.emit('claimSquare', {
          matchId,
          squareId: 0,
          selectionId: 'test-claim-p2-first'
        })
        
        setTimeout(() => {
          try {
            expect(rejected).toBe(true)
            expect(rejectionReason).toBe('not_your_turn')
            clearTimeout(timeout)
            resolve()
          } catch (error) {
            clearTimeout(timeout)
            reject(error)
          }
        }, 200)
      })
      
      socket1.emit('quickMatch')
      socket2.emit('quickMatch')
    })
  })

  test('Turn alternation: P1 -> P2 -> P1', async () => {
    const socket1 = await createConnection()
    const socket2 = await createConnection()

    const allEvents: any[] = []
    
    socket1.on('squareClaimed', (data) => allEvents.push({ ...data, receiver: 'socket1' }))
    socket2.on('squareClaimed', (data) => allEvents.push({ ...data, receiver: 'socket2' }))

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Test timeout')), 10000)
      let moveCount = 0
      
      const makeMove = (socket: ClientSocket, matchId: string, squareId: number) => {
        socket.emit('claimSquare', {
          matchId,
          squareId,
          selectionId: `move-${moveCount++}`
        })
      }
      
      socket1.on('matchStart', (data: any) => {
        const matchId = data.roomId
        makeMove(socket1, matchId, 0) // P1 first move
        
        // Set up sequence after each claim
        socket1.on('squareClaimed', (claimData) => {
          if (claimData.squareId === 0 && claimData.nextTurn === 'P2') {
            setTimeout(() => makeMove(socket2, matchId, 1), 50) // P2 move
          } else if (claimData.squareId === 1 && claimData.nextTurn === 'P1') {
            setTimeout(() => makeMove(socket1, matchId, 2), 50) // P1 second move
          } else if (claimData.squareId === 2 && claimData.nextTurn === 'P2') {
            // Verify sequence after third move
            setTimeout(() => {
              try {
                // Filter to unique moves (each move received by both sockets)
                const moves = allEvents
                  .filter((e, i, arr) => arr.findIndex(x => x.squareId === e.squareId && x.version === e.version) === i)
                  .sort((a, b) => a.version - b.version)
                
                expect(moves).toHaveLength(3)
                expect(moves[0]).toMatchObject({ squareId: 0, by: 'P1', nextTurn: 'P2' })
                expect(moves[1]).toMatchObject({ squareId: 1, by: 'P2', nextTurn: 'P1' })
                expect(moves[2]).toMatchObject({ squareId: 2, by: 'P1', nextTurn: 'P2' })
                
                clearTimeout(timeout)
                resolve()
              } catch (error) {
                clearTimeout(timeout)
                reject(error)
              }
            }, 100)
          }
        })
      })
      
      socket1.emit('quickMatch')
      socket2.emit('quickMatch')
    })
  })
})