import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { Matchmaker } from '../services/matchmaker.js'

describe('Matchmaker Unit Tests', () => {
  let matchmaker: Matchmaker

  beforeEach(() => {
    matchmaker = new Matchmaker()
  })

  afterEach(() => {
    matchmaker.destroy()
  })

  describe('Quick Match Pairing', () => {
    test('queues single player', async () => {
      const result = await matchmaker.requestQuickMatch('player1', 'socket1')
      
      expect(result.type).toBe('queued')
      expect(result.correlationId).toBeTruthy()
      
      const queueStatus = matchmaker.getQueueStatus()
      expect(queueStatus.length).toBe(1)
      expect(queueStatus.headSample).toContain('player1')
    })

    test('pairs two players immediately', async () => {
      const result1 = await matchmaker.requestQuickMatch('player1', 'socket1')
      expect(result1.type).toBe('queued')
      
      const result2 = await matchmaker.requestQuickMatch('player2', 'socket2')
      expect(result2.type).toBe('paired')
      expect(result2.room).toBeTruthy()
      expect(result2.room?.players).toHaveLength(2)
      expect(result2.room?.status).toBe('active')
      
      const queueStatus = matchmaker.getQueueStatus()
      expect(queueStatus.length).toBe(0)
    })

    test('handles multiple concurrent requests', async () => {
      const promises = []
      for (let i = 0; i < 10; i++) {
        promises.push(matchmaker.requestQuickMatch(`player${i}`, `socket${i}`))
      }
      
      const results = await Promise.all(promises)
      
      // Should have paired all 10 players (5 pairs)
      const pairedResults = results.filter(r => r.type === 'paired')
      const queuedResults = results.filter(r => r.type === 'queued')
      
      expect(pairedResults.length).toBeGreaterThanOrEqual(4) // At least 4 players paired
      expect(queuedResults.length).toBeLessThanOrEqual(6) // At most 6 queued initially
      
      const queueStatus = matchmaker.getQueueStatus()
      expect(queueStatus.length).toBe(0) // All should be paired
    })

    test('prevents duplicate player in queue', async () => {
      await matchmaker.requestQuickMatch('player1', 'socket1')
      
      // Same player requests again (updated socket)
      await matchmaker.requestQuickMatch('player1', 'socket1-new')
      
      const queueStatus = matchmaker.getQueueStatus()
      expect(queueStatus.length).toBe(1)
      expect(queueStatus.headSample).toContain('player1')
    })
  })

  describe('Queue Management', () => {
    test('removes player from queue', async () => {
      await matchmaker.requestQuickMatch('player1', 'socket1')
      await matchmaker.requestQuickMatch('player2', 'socket2')
      
      let queueStatus = matchmaker.getQueueStatus()
      expect(queueStatus.length).toBe(0) // Both paired
      
      await matchmaker.requestQuickMatch('player3', 'socket3')
      queueStatus = matchmaker.getQueueStatus()
      expect(queueStatus.length).toBe(1)
      
      await matchmaker.removeFromQueue('player3')
      queueStatus = matchmaker.getQueueStatus()
      expect(queueStatus.length).toBe(0)
    })

    test('handles removal of non-existent player', async () => {
      await matchmaker.removeFromQueue('non-existent')
      const queueStatus = matchmaker.getQueueStatus()
      expect(queueStatus.length).toBe(0)
    })
  })

  describe('Room Management', () => {
    test('creates room with correct properties', async () => {
      await matchmaker.requestQuickMatch('player1', 'socket1')
      const result = await matchmaker.requestQuickMatch('player2', 'socket2')
      
      expect(result.type).toBe('paired')
      expect(result.room).toBeTruthy()
      
      const room = result.room!
      expect(room.id).toBeTruthy()
      expect(room.code).toMatch(/^ROOM-[A-Z0-9]{6}$/)
      expect(room.status).toBe('active')
      expect(room.players).toHaveLength(2)
      expect(room.players[0].id).toBe('player1')
      expect(room.players[1].id).toBe('player2')
      expect(room.matchStartedAt).toBeTruthy()
      expect(room.isPublic).toBe(false)
    })

    test('retrieves created room', async () => {
      await matchmaker.requestQuickMatch('player1', 'socket1')
      const result = await matchmaker.requestQuickMatch('player2', 'socket2')
      
      const room = matchmaker.getRoom(result.room!.id)
      expect(room).toBeTruthy()
      expect(room?.id).toBe(result.room!.id)
    })
  })

  describe('Watchdog System', () => {
    test('starts and clears watchdog', async () => {
      let callbackCalled = false
      
      matchmaker.startWatchdog('room1', () => {
        callbackCalled = true
      })
      
      // Clear before timeout
      matchmaker.clearWatchdog('room1')
      
      // Wait to ensure callback is not called
      await new Promise(resolve => setTimeout(resolve, 2500))
      expect(callbackCalled).toBe(false)
    })

    test('watchdog triggers after timeout', async () => {
      let callbackCalled = false
      
      matchmaker.startWatchdog('room1', () => {
        callbackCalled = true
      })
      
      // Wait for watchdog to trigger (2 seconds)
      await new Promise(resolve => setTimeout(resolve, 2500))
      expect(callbackCalled).toBe(true)
    })

    test('replaces existing watchdog', async () => {
      let firstCallbackCalled = false
      let secondCallbackCalled = false
      
      matchmaker.startWatchdog('room1', () => {
        firstCallbackCalled = true
      })
      
      // Replace with new watchdog
      matchmaker.startWatchdog('room1', () => {
        secondCallbackCalled = true
      })
      
      // Wait for watchdog to trigger
      await new Promise(resolve => setTimeout(resolve, 2500))
      
      expect(firstCallbackCalled).toBe(false)
      expect(secondCallbackCalled).toBe(true)
    })
  })

  describe('Debug Methods', () => {
    test('getQueueStatus returns correct information', async () => {
      for (let i = 1; i <= 7; i++) {
        await matchmaker.requestQuickMatch(`player${i}`, `socket${i}`)
      }
      
      const status = matchmaker.getQueueStatus()
      expect(status.length).toBe(1) // 3 pairs matched, 1 queued
      expect(status.headSample).toHaveLength(1)
    })

    test('getRoomsStatus returns correct counts', async () => {
      // Create some rooms by pairing players
      for (let i = 1; i <= 6; i++) {
        await matchmaker.requestQuickMatch(`player${i}`, `socket${i}`)
      }
      
      const status = matchmaker.getRoomsStatus()
      expect(status.active).toBe(3) // 3 pairs = 3 active rooms
      expect(status.waiting).toBe(0)
      expect(status.sampleIds).toHaveLength(3)
    })
  })
})