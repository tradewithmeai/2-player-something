import { test, expect, describe, beforeEach, afterEach, vi } from 'vitest'
import { RoomManager } from '../services/roomManager.js'

describe('RoomManager', () => {
  let roomManager: RoomManager
  
  beforeEach(() => {
    roomManager = new RoomManager()
  })

  afterEach(() => {
    roomManager.destroy()
  })

  describe('Room Creation', () => {
    test('creates room with unique ID and code', () => {
      const room1 = roomManager.createRoom('player1', 'socket1')
      const room2 = roomManager.createRoom('player2', 'socket2')

      expect(room1.id).not.toBe(room2.id)
      expect(room1.code).not.toBe(room2.code)
      expect(room1.code).toMatch(/^ROOM-[A-Z0-9]{6}$/)
      expect(room1.status).toBe('waiting')
      expect(room1.players).toHaveLength(1)
      expect(room1.players[0].id).toBe('player1')
    })

    test('creates public and private rooms', () => {
      const privateRoom = roomManager.createRoom('player1', 'socket1', false)
      const publicRoom = roomManager.createRoom('player2', 'socket2', true)

      expect(privateRoom.isPublic).toBe(false)
      expect(publicRoom.isPublic).toBe(true)
    })
  })

  describe('Room Joining', () => {
    test('allows player to join waiting room', () => {
      const room = roomManager.createRoom('player1', 'socket1')
      const joinedRoom = roomManager.joinRoom('player2', 'socket2', room.code)

      expect(joinedRoom).toBeTruthy()
      expect(joinedRoom!.players).toHaveLength(2)
      expect(joinedRoom!.players.find(p => p.id === 'player2')).toBeTruthy()
    })

    test('prevents joining non-existent room', () => {
      const result = roomManager.joinRoom('player1', 'socket1', 'ROOM-INVALID')
      expect(result).toBeNull()
    })

    test('prevents joining full room', () => {
      const room = roomManager.createRoom('player1', 'socket1')
      roomManager.joinRoom('player2', 'socket2', room.code)
      
      // Try to join full room
      const result = roomManager.joinRoom('player3', 'socket3', room.code)
      expect(result).toBeNull()
    })

    test('prevents joining active room', () => {
      const room = roomManager.createRoom('player1', 'socket1')
      roomManager.joinRoom('player2', 'socket2', room.code)
      
      // Room should auto-start when full
      expect(room.status).toBe('active')
      
      // Try to join active room
      const result = roomManager.joinRoom('player3', 'socket3', room.code)
      expect(result).toBeNull()
    })

    test('prevents duplicate player joining', () => {
      const room = roomManager.createRoom('player1', 'socket1')
      const result = roomManager.joinRoom('player1', 'socket1', room.code)
      
      expect(result).toBeNull()
      expect(room.players).toHaveLength(1)
    })
  })

  describe('Room Leaving', () => {
    test('removes player from room', () => {
      const room = roomManager.createRoom('player1', 'socket1')
      roomManager.joinRoom('player2', 'socket2', room.code)
      
      const updatedRoom = roomManager.leaveRoom('player2')
      
      expect(updatedRoom).toBeTruthy()
      expect(updatedRoom!.players).toHaveLength(1)
      expect(updatedRoom!.players.find(p => p.id === 'player2')).toBeFalsy()
    })

    test('removes empty waiting room', () => {
      const room = roomManager.createRoom('player1', 'socket1')
      roomManager.leaveRoom('player1')
      
      const foundRoom = roomManager.getRoom(room.id)
      expect(foundRoom).toBeUndefined()
    })

    test('keeps active room even if players leave', () => {
      const room = roomManager.createRoom('player1', 'socket1')
      roomManager.joinRoom('player2', 'socket2', room.code)
      
      // Room should be active
      expect(room.status).toBe('active')
      
      // Leave room
      roomManager.leaveRoom('player1')
      
      // Room should still exist
      const foundRoom = roomManager.getRoom(room.id)
      expect(foundRoom).toBeTruthy()
      expect(foundRoom!.players).toHaveLength(1)
    })
  })

  describe('Quick Match', () => {
    test('queues single player', () => {
      const result = roomManager.quickMatch('player1', 'socket1')
      
      expect(result).toBe('queued')
      expect(roomManager.getQueueLength()).toBe(1)
    })

    test('matches two queued players', () => {
      const result1 = roomManager.quickMatch('player1', 'socket1')
      expect(result1).toBe('queued')
      
      const result2 = roomManager.quickMatch('player2', 'socket2')
      expect(result2).not.toBe('queued')
      
      const room = result2 as any
      expect(room.players).toHaveLength(2)
      expect(room.status).toBe('active')
      expect(room.isPublic).toBe(true)
      expect(roomManager.getQueueLength()).toBe(0)
    })

    test('joins existing public waiting room', () => {
      // Create a public room with one player
      const room = roomManager.createRoom('player1', 'socket1', true)
      
      // Quick match should join this room
      const result = roomManager.quickMatch('player2', 'socket2')
      
      expect(result).not.toBe('queued')
      expect((result as any).id).toBe(room.id)
      expect(room.players).toHaveLength(2)
    })

    test('removes player from existing room before quick match', () => {
      const room1 = roomManager.createRoom('player1', 'socket1')
      const result = roomManager.quickMatch('player1', 'socket1-new')
      
      expect(result).toBe('queued')
      expect(room1.players).toHaveLength(0)
      const foundRoom = roomManager.getRoom(room1.id)
      expect(foundRoom).toBeUndefined() // Empty room should be deleted
    })
  })

  describe('Match Starting', () => {
    test('starts match when room is full', () => {
      const room = roomManager.createRoom('player1', 'socket1')
      roomManager.joinRoom('player2', 'socket2', room.code)
      
      expect(room.status).toBe('active')
      expect(room.matchStartedAt).toBeTruthy()
    })

    test('starts match when all players ready', () => {
      const room = roomManager.createRoom('player1', 'socket1')
      roomManager.joinRoom('player2', 'socket2', room.code)
      
      // Room auto-starts when full, but let's test ready system
      room.status = 'waiting' // Reset for test
      
      roomManager.updatePlayerReady('player1', true)
      expect(room.status).toBe('waiting') // Not all ready yet
      
      roomManager.updatePlayerReady('player2', true)
      expect(room.status).toBe('active') // All ready, should start
    })

    test('returns match object when starting', () => {
      const room = roomManager.createRoom('player1', 'socket1')
      room.status = 'waiting' // Reset auto-start
      roomManager.joinRoom('player2', 'socket2', room.code)
      room.status = 'waiting' // Reset auto-start again after join
      
      const match = roomManager.startMatch(room.id)
      
      expect(match).toBeTruthy()
      expect(match!.roomId).toBe(room.id)
      expect(match!.players).toHaveLength(2)
      expect(match!.startedAt).toBeTruthy()
    })

    test('fails to start match with insufficient players', () => {
      const room = roomManager.createRoom('player1', 'socket1')
      room.status = 'waiting'
      
      const match = roomManager.startMatch(room.id)
      expect(match).toBeNull()
      expect(room.status).toBe('waiting')
    })
  })

  describe('Public Rooms', () => {
    test('returns only public waiting rooms', () => {
      roomManager.createRoom('player1', 'socket1', false)
      const publicRoom1 = roomManager.createRoom('player2', 'socket2', true)
      const publicRoom2 = roomManager.createRoom('player3', 'socket3', true)
      
      // Make one room active
      roomManager.joinRoom('player4', 'socket4', publicRoom2.code)
      
      const publicRooms = roomManager.getPublicRooms()
      
      expect(publicRooms).toHaveLength(1)
      expect(publicRooms[0].id).toBe(publicRoom1.id)
      expect(publicRooms[0].isPublic).toBe(true)
      expect(publicRooms[0].status).toBe('waiting')
    })

    test('limits returned rooms to specified limit', () => {
      // Create multiple public rooms
      for (let i = 0; i < 60; i++) {
        roomManager.createRoom(`player${i}`, `socket${i}`, true)
      }
      
      const publicRooms = roomManager.getPublicRooms(10)
      expect(publicRooms).toHaveLength(10)
    })
  })

  describe('Player Ready System', () => {
    test('updates player ready status', () => {
      const room = roomManager.createRoom('player1', 'socket1')
      roomManager.updatePlayerReady('player1', true)
      
      const player = room.players.find(p => p.id === 'player1')
      expect(player!.isReady).toBe(true)
    })

    test('returns null for non-existent player', () => {
      const result = roomManager.updatePlayerReady('nonexistent', true)
      expect(result).toBeNull()
    })
  })

  describe('Room Cleanup', () => {
    test('cleans up idle rooms after timeout', () => {
      const room = roomManager.createRoom('player1', 'socket1')
      expect(roomManager.getRoomCount()).toBe(1)
      
      // Manually set lastActivity to 3 minutes ago
      room.lastActivity = new Date(Date.now() - 3 * 60 * 1000)
      
      // Trigger cleanup manually
      roomManager.cleanupIdleRooms()
      
      // Room should be cleaned up
      const foundRoom = roomManager.getRoom(room.id)
      expect(foundRoom).toBeUndefined()
      expect(roomManager.getRoomCount()).toBe(0)
    })

    test('keeps active rooms during cleanup', () => {
      const room = roomManager.createRoom('player1', 'socket1')
      roomManager.joinRoom('player2', 'socket2', room.code)
      
      expect(room.status).toBe('active')
      expect(roomManager.getRoomCount()).toBe(1)
      
      // Manually set lastActivity to 3 minutes ago
      room.lastActivity = new Date(Date.now() - 3 * 60 * 1000)
      
      // Trigger cleanup manually
      roomManager.cleanupIdleRooms()
      
      // Active room should remain
      const foundRoom = roomManager.getRoom(room.id)
      expect(foundRoom).toBeTruthy()
      expect(roomManager.getRoomCount()).toBe(1)
    })
  })

  describe('Room Updates', () => {
    test('creates proper room update object', () => {
      const room = roomManager.createRoom('player1', 'socket1')
      const update = roomManager.createRoomUpdate(room, 'player_joined')
      
      expect(update.type).toBe('player_joined')
      expect(update.room.id).toBe(room.id)
      expect(update.room.players).toHaveLength(1)
      // Should not include socketId in update
      expect(update.room.players[0]).not.toHaveProperty('socketId')
    })
  })

  describe('Edge Cases', () => {
    test('handles room code collision gracefully', () => {
      // Mock generateRoomCode to return same value
      const originalGenerateRoomCode = roomManager.generateRoomCode.bind(roomManager)
      roomManager.generateRoomCode = vi.fn().mockReturnValue('ROOM-TEST123')
      
      const room1 = roomManager.createRoom('player1', 'socket1')
      const room2 = roomManager.createRoom('player2', 'socket2')
      
      // Even with same code, rooms should have different IDs
      expect(room1.id).not.toBe(room2.id)
      expect(room1.code).toBe(room2.code)
      
      // Restore original method
      roomManager.generateRoomCode = originalGenerateRoomCode
    })

    test('handles concurrent quick match requests', () => {
      // Simulate multiple players requesting quick match simultaneously
      const results = [
        roomManager.quickMatch('player1', 'socket1'),
        roomManager.quickMatch('player2', 'socket2'),
        roomManager.quickMatch('player3', 'socket3'),
        roomManager.quickMatch('player4', 'socket4'),
      ]
      
      // Should have created one match and queued two players
      const matches = results.filter(r => r !== 'queued')
      const queued = results.filter(r => r === 'queued')
      
      expect(matches).toHaveLength(2) // Two matches created
      expect(queued).toHaveLength(2) // Two players still queued
      expect(roomManager.getQueueLength()).toBe(0) // But queue should be empty due to matching
    })
  })
})