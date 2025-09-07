import { test, expect, describe, beforeAll, afterAll } from 'vitest'
import Fastify, { FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import fastifySocketIO from 'fastify-socket.io'

describe('Server Health Check', () => {
  let server: FastifyInstance

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

    server.get('/health', async (request, reply) => {
      return { 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      }
    })

    await server.ready()
  })

  afterAll(async () => {
    await server.close()
  })

  test('GET /health returns 200 and correct response', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/health'
    })

    expect(response.statusCode).toBe(200)
    
    const body = JSON.parse(response.body)
    expect(body).toHaveProperty('status', 'ok')
    expect(body).toHaveProperty('timestamp')
    expect(body).toHaveProperty('uptime')
    expect(typeof body.uptime).toBe('number')
  })

  test('Health endpoint returns valid timestamp', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/health'
    })

    const body = JSON.parse(response.body)
    const timestamp = new Date(body.timestamp)
    expect(timestamp.getTime()).not.toBeNaN()
  })
})