import { Room, Player, Match, RoomUpdate, QuickMatchRequest } from '../types/room.js'
import { GameRegistry } from './gameRegistry.js'

export class RoomManager {
  private rooms = new Map<string, Room>()
  private playerRooms = new Map<string, string>() // playerId -> roomId
  private quickMatchQueue: QuickMatchRequest[] = []
  private cleanupInterval: NodeJS.Timeout

  constructor() {
    // Start cleanup interval for idle rooms (every 30 seconds)
    this.cleanupInterval = setInterval(() => this.cleanupIdleRooms(), 30000)
  }

  generateRoomCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    const prefix = 'ROOM-'
    let code = ''
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return prefix + code
  }

  generateRoomId(): string {
    return 'room_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
  }

  createRoom(creatorId: string, creatorSocketId: string, isPublic = false): Room {
    const room: Room = {
      id: this.generateRoomId(),
      code: this.generateRoomCode(),
      status: 'waiting',
      players: [{
        id: creatorId,
        socketId: creatorSocketId,
        joinedAt: new Date(),
        isReady: false
      }],
      maxPlayers: 2,
      createdAt: new Date(),
      lastActivity: new Date(),
      isPublic
    }

    this.rooms.set(room.id, room)
    this.playerRooms.set(creatorId, room.id)
    
    return room
  }

  joinRoom(playerId: string, playerSocketId: string, roomCode: string): Room | null {
    const room = this.findRoomByCode(roomCode)
    
    if (!room) return null
    if (room.status !== 'waiting') return null
    if (room.players.length >= room.maxPlayers) return null
    if (room.players.some(p => p.id === playerId)) return null

    const player: Player = {
      id: playerId,
      socketId: playerSocketId,
      joinedAt: new Date(),
      isReady: false
    }

    room.players.push(player)
    room.lastActivity = new Date()
    this.playerRooms.set(playerId, room.id)

    // Auto-start match if room is full
    if (room.players.length === room.maxPlayers) {
      this.startMatch(room.id)
    }

    return room
  }

  leaveRoom(playerId: string): Room | null {
    const roomId = this.playerRooms.get(playerId)
    if (!roomId) return null

    const room = this.rooms.get(roomId)
    if (!room) return null

    room.players = room.players.filter(p => p.id !== playerId)
    room.lastActivity = new Date()
    this.playerRooms.delete(playerId)

    // Remove room if empty and not active
    if (room.players.length === 0 && room.status === 'waiting') {
      this.rooms.delete(roomId)
      return null
    }

    return room
  }

  quickMatch(playerId: string, playerSocketId: string): Room | 'queued' {
    // Remove from any existing room first
    this.leaveRoom(playerId)

    // Check if there's an available waiting room
    const availableRoom = Array.from(this.rooms.values()).find(room => 
      room.status === 'waiting' && 
      room.players.length < room.maxPlayers &&
      room.isPublic
    )

    if (availableRoom) {
      this.joinRoom(playerId, playerSocketId, availableRoom.code)
      return availableRoom
    }

    // Add to queue
    this.quickMatchQueue = this.quickMatchQueue.filter(req => req.playerId !== playerId)
    this.quickMatchQueue.push({ playerId, socketId: playerSocketId })

    // Try to match with another queued player
    if (this.quickMatchQueue.length >= 2) {
      const [player1, player2] = this.quickMatchQueue.splice(0, 2)
      
      // Create room for matched players
      const room = this.createRoom(player1.playerId, player1.socketId, true)
      this.joinRoom(player2.playerId, player2.socketId, room.code)
      
      return room
    }

    return 'queued'
  }

  startMatch(roomId: string): Match | null {
    const room = this.rooms.get(roomId)
    if (!room || room.status !== 'waiting' || room.players.length !== room.maxPlayers) {
      return null
    }

    room.status = 'active'
    room.matchStartedAt = new Date()
    room.lastActivity = new Date()

    const match: Match = {
      roomId: room.id,
      players: [...room.players],
      startedAt: new Date()
    }

    return match
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId)
  }

  getRoomByPlayerId(playerId: string): Room | null {
    const roomId = this.playerRooms.get(playerId)
    return roomId ? this.rooms.get(roomId) || null : null
  }

  getRoomByMatchId(matchId: string): Room | null {
    const roomId = GameRegistry.getRoomIdForMatch(matchId)
    return roomId ? this.rooms.get(roomId) || null : null
  }

  setMatchRoom(matchId: string, roomId: string): void {
    GameRegistry.setMatchRoom(matchId, roomId)
  }

  findRoomByCode(code: string): Room | null {
    return Array.from(this.rooms.values()).find(room => room.code === code) || null
  }

  getPublicRooms(limit = 50): Room[] {
    return Array.from(this.rooms.values())
      .filter(room => room.isPublic && room.status === 'waiting')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
  }

  updatePlayerReady(playerId: string, ready: boolean): Room | null {
    const room = this.getRoomByPlayerId(playerId)
    if (!room) return null

    const player = room.players.find(p => p.id === playerId)
    if (!player) return null

    player.isReady = ready
    room.lastActivity = new Date()

    // Check if all players are ready and auto-start
    if (room.status === 'waiting' && 
        room.players.length === room.maxPlayers && 
        room.players.every(p => p.isReady)) {
      this.startMatch(room.id)
    }

    return room
  }

  cleanupIdleRooms(): void {
    const now = new Date()
    const idleThreshold = 2 * 60 * 1000 // 2 minutes

    for (const [roomId, room] of this.rooms.entries()) {
      const timeSinceActivity = now.getTime() - room.lastActivity.getTime()
      
      if (timeSinceActivity > idleThreshold && room.status !== 'active') {
        // Remove players from room mapping
        room.players.forEach(player => {
          this.playerRooms.delete(player.id)
        })
        
        // Remove room
        this.rooms.delete(roomId)
        console.log(`Cleaned up idle room: ${roomId} (${room.code})`)
      }
    }

    // Clean up stale quick match requests (older than 5 minutes)
    // Note: We don't have timestamp on QuickMatchRequest, so this is a simple cleanup
    // In a production system, you'd want to add timestamps
    // For now, keep all requests
    this.quickMatchQueue = this.quickMatchQueue.filter(() => true)
  }

  createRoomUpdate(room: Room, type: RoomUpdate['type']): RoomUpdate {
    return {
      room: {
        id: room.id,
        code: room.code,
        status: room.status,
        players: room.players.map(p => ({
          id: p.id,
          joinedAt: p.joinedAt,
          isReady: p.isReady
        })),
        maxPlayers: room.maxPlayers,
        createdAt: room.createdAt,
        lastActivity: room.lastActivity,
        matchStartedAt: room.matchStartedAt,
        isPublic: room.isPublic
      },
      type
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }
  }

  // Debug methods
  getRoomCount(): number {
    return this.rooms.size
  }

  getQueueLength(): number {
    return this.quickMatchQueue.length
  }
}