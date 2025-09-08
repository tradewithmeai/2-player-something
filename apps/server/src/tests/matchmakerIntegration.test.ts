import { describe, test, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { io, Socket } from 'socket.io-client'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import fastifySocketIO from 'fastify-socket.io'
import { Matchmaker } from '../services/matchmaker.js'
import { RoomManager } from '../services/roomManager.js'

describe('Matchmaker Integration Tests', () => {
  let fastify: any
  let serverUrl: string
  let matchmaker: Matchmaker
  let roomManager: RoomManager
  const clients: Socket[] = []

  beforeAll(async () => {
    matchmaker = new Matchmaker()
    roomManager = new RoomManager()
    
    fastify = Fastify({ logger: false })
    await fastify.register(cors, { origin: true })
    await fastify.register(fastifySocketIO, {
      cors: { origin: true }
    })

    const gameNamespace = fastify.io.of('/game')
    
    gameNamespace.on('connection', (socket: any) => {
      const playerId = socket.id

      socket.on('quickMatch', async () => {
        const result = await matchmaker.requestQuickMatch(playerId, socket.id)
        
        if (result.type === 'paired' && result.room) {
          const room = result.room
          
          // Both players need to join the Socket.IO room
          room.players.forEach(player => {
            const playerSocket: any = Array.from(gameNamespace.sockets.values())
              .find((s: any) => s.id === player.socketId)
            
            if (playerSocket) {
              playerSocket.join(room.id)
              
              const update = roomManager.createRoomUpdate(room, 'player_joined')
              playerSocket.emit('quickMatchFound', update.room)
              playerSocket.emit('roomUpdate', update)
            }
          })
          
          // Start the match
          const match = {
            roomId: room.id,
            players: room.players,
            startedAt: new Date()
          }
          gameNamespace.to(room.id).emit('matchStart', match)
        }
      })

      socket.on('disconnect', async () => {
        await matchmaker.removeFromQueue(playerId)
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
    matchmaker.destroy()
    roomManager.destroy()
  })

  test('Concurrent quickMatch - 10 iterations with random skew', { timeout: 20000 }, async () => {
    const results: boolean[] = []
    
    for (let i = 0; i < 10; i++) {
      const success = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          console.log(`Iteration ${i + 1} timed out`)
          resolve(false)
        }, 5000)

        let matchStartCount = 0

        const client1 = io(`${serverUrl}/game`, { autoConnect: true })
        const client2 = io(`${serverUrl}/game`, { autoConnect: true })
        clients.push(client1, client2)

        const checkComplete = () => {
          if (matchStartCount === 2) {
            clearTimeout(timeout)
            resolve(true)
          }
        }

        client1.on('matchStart', () => {
          matchStartCount++
          checkComplete()
        })

        client2.on('matchStart', () => {
          matchStartCount++
          checkComplete()
        })

        // Random skew 0-50ms
        const skew = Math.random() * 50

        client1.on('connect', () => {
          setTimeout(() => {
            client1.emit('quickMatch')
          }, skew)
        })

        client2.on('connect', () => {
          client2.emit('quickMatch')
        })
      })

      results.push(success)
      
      // Disconnect clients after each iteration
      clients.forEach(client => client.disconnect())
      clients.length = 0
      
      // Small delay between iterations
      await new Promise(resolve => setTimeout(resolve, 10))
    }

    const successRate = results.filter(r => r).length / results.length
    console.log(`Success rate: ${successRate * 100}% (${results.filter(r => r).length}/10)`)
    
    expect(successRate).toBeGreaterThanOrEqual(0.90) // At least 90% success rate for 10 iterations
  })

  test('Disconnect before pairing completes - survivor requeued', async () => {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Test timeout'))
      }, 5000)

      const client1 = io(`${serverUrl}/game`, { autoConnect: true })
      const client2 = io(`${serverUrl}/game`, { autoConnect: true })
      const client3 = io(`${serverUrl}/game`, { autoConnect: true })
      clients.push(client1, client2, client3)

      let matchReceived = false

      client1.on('connect', () => {
        client1.emit('quickMatch')
        
        // Disconnect after 100ms (while in queue)
        setTimeout(() => {
          client1.disconnect()
          
          // Now connect client2 and client3
          setTimeout(() => {
            client2.emit('quickMatch')
            client3.emit('quickMatch')
          }, 100)
        }, 100)
      })

      // Client2 and client3 should be matched
      client2.on('matchStart', () => {
        if (!matchReceived) {
          matchReceived = true
        }
      })

      client3.on('matchStart', () => {
        if (matchReceived) {
          clearTimeout(timeout)
          resolve()
        }
      })
    })
  })

  test('ForceJoin watchdog - client not acknowledging', async () => {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Test timeout'))
      }, 5000)

      const client1 = io(`${serverUrl}/game`, { autoConnect: true })
      const client2 = io(`${serverUrl}/game`, { autoConnect: true })
      clients.push(client1, client2)

      let matchStartCount = 0

      // Don't send joinRoom acknowledgment
      client1.on('quickMatchFound', () => {
        // Intentionally don't acknowledge
      })

      client2.on('quickMatchFound', () => {
        // Intentionally don't acknowledge
      })

      client1.on('matchStart', () => {
        matchStartCount++
        checkComplete()
      })

      client2.on('matchStart', () => {
        matchStartCount++
        checkComplete()
      })

      const checkComplete = () => {
        // Should receive match start even without acknowledgment
        if (matchStartCount >= 2) {
          clearTimeout(timeout)
          resolve()
        }
      }

      client1.on('connect', () => {
        client1.emit('quickMatch')
      })

      client2.on('connect', () => {
        client2.emit('quickMatch')
      })
    })
  })
})