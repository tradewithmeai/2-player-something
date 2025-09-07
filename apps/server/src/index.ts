import Fastify from 'fastify'
import cors from '@fastify/cors'
import { Server as SocketIOServer } from 'socket.io'
import fastifySocketIO from 'fastify-socket.io'
import 'dotenv/config'

const PORT = parseInt(process.env.PORT || '3001', 10)
const HOST = process.env.HOST || '0.0.0.0'
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173'

const fastify = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'development' ? 'info' : 'warn'
  }
})

await fastify.register(cors, {
  origin: [CLIENT_URL, 'http://localhost:3000', 'http://localhost:5173'],
  methods: ['GET', 'POST'],
  credentials: true
})

await fastify.register(fastifySocketIO, {
  cors: {
    origin: [CLIENT_URL, 'http://localhost:3000', 'http://localhost:5173'],
    methods: ['GET', 'POST'],
    credentials: true
  }
})

fastify.get('/health', async (request, reply) => {
  return { 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  }
})

const gameNamespace = fastify.io.of('/game')

gameNamespace.on('connection', (socket) => {
  console.log(`Client connected to game namespace: ${socket.id}`)

  socket.emit('welcome', { 
    message: 'Connected to game server',
    socketId: socket.id,
    timestamp: new Date().toISOString()
  })

  socket.on('ping', (data) => {
    console.log('Received ping from', socket.id, data)
    socket.emit('pong', { 
      ...data, 
      serverTime: new Date().toISOString(),
      socketId: socket.id
    })
  })

  socket.on('disconnect', (reason) => {
    console.log(`Client disconnected from game namespace: ${socket.id}, reason: ${reason}`)
  })
})

fastify.io.on('connection', (socket) => {
  console.log(`Client connected to default namespace: ${socket.id}`)

  socket.on('ping', (data) => {
    console.log('Received ping from', socket.id, data)
    socket.emit('pong', { 
      ...data, 
      serverTime: new Date().toISOString(),
      socketId: socket.id
    })
  })

  socket.on('disconnect', (reason) => {
    console.log(`Client disconnected: ${socket.id}, reason: ${reason}`)
  })
})

const start = async () => {
  try {
    await fastify.listen({ port: PORT, host: HOST })
    console.log(`Server running at http://${HOST}:${PORT}`)
    console.log(`Socket.IO server ready on /game namespace`)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()