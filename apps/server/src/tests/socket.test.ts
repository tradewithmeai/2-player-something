import { test, expect, describe, beforeAll, afterAll } from 'vitest'
import Fastify, { FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import fastifySocketIO from 'fastify-socket.io'
import { io as ioc, Socket as ClientSocket } from 'socket.io-client'
import { Socket } from 'socket.io'

interface PingData {
  clientTime: string
  message: string
}


describe('Socket.IO Integration', () => {
  let server: FastifyInstance
  let serverURL: string
  const connectedSockets: ClientSocket[] = []

  beforeAll(async () => {
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

    gameNamespace.on('connection', (socket: Socket) => {
      socket.emit('welcome', { 
        message: 'Connected to game server',
        socketId: socket.id,
        timestamp: new Date().toISOString()
      })

      socket.on('ping', (data: PingData) => {
        socket.emit('pong', { 
          ...data, 
          serverTime: new Date().toISOString(),
          socketId: socket.id
        })
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

  test('Socket connects to /game namespace and receives welcome', async () => {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        client.disconnect()
        reject(new Error('Test timeout'))
      }, 8000)

      const client = ioc(`${serverURL}/game`, {
        forceNew: true,
        autoConnect: true,
        transports: ['websocket', 'polling']
      })

      connectedSockets.push(client)

      client.on('connect', () => {
        expect(client.connected).toBe(true)
      })

      client.on('welcome', (data) => {
        try {
          expect(data).toHaveProperty('message', 'Connected to game server')
          expect(data).toHaveProperty('socketId')
          expect(data).toHaveProperty('timestamp')
          clearTimeout(timeout)
          resolve()
        } catch (err) {
          clearTimeout(timeout)
          reject(err)
        }
      })

      client.on('connect_error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
    })
  }, 10000)

  test('Socket ping/pong communication works', async () => {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        client.disconnect()
        reject(new Error('Test timeout'))
      }, 8000)

      const client = ioc(`${serverURL}/game`, {
        forceNew: true,
        autoConnect: true,
        transports: ['websocket', 'polling']
      })

      connectedSockets.push(client)

      const pingData = {
        clientTime: new Date().toISOString(),
        message: 'test ping'
      }

      client.on('connect', () => {
        client.emit('ping', pingData)
      })

      client.on('pong', (data) => {
        try {
          expect(data).toHaveProperty('clientTime', pingData.clientTime)
          expect(data).toHaveProperty('message', pingData.message)
          expect(data).toHaveProperty('serverTime')
          expect(data).toHaveProperty('socketId')
          
          const serverTime = new Date(data.serverTime)
          expect(serverTime.getTime()).not.toBeNaN()
          
          clearTimeout(timeout)
          resolve()
        } catch (err) {
          clearTimeout(timeout)
          reject(err)
        }
      })

      client.on('connect_error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
    })
  }, 10000)
})