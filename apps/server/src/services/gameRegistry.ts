/**
 * Single source of truth for match↔room mappings
 * Shared singleton instance to prevent mapping inconsistencies
 */

class GameRegistryClass {
  private roomByMatch = new Map<string, string>()
  private matchByRoom = new Map<string, string>()

  getRoomIdForMatch(matchId: string): string | null {
    return this.roomByMatch.get(matchId) || null
  }

  getMatchIdForRoom(roomId: string): string | null {
    return this.matchByRoom.get(roomId) || null
  }

  setMatchRoom(matchId: string, roomId: string): void {
    // Remove any existing mappings for this match or room
    this.removeMappingsForMatch(matchId)
    this.removeMappingsForRoom(roomId)
    
    // Set new bidirectional mapping
    this.roomByMatch.set(matchId, roomId)
    this.matchByRoom.set(roomId, matchId)

    console.log(JSON.stringify({
      evt: 'gameRegistry.setMapping',
      matchId,
      roomId,
      totalMappings: this.roomByMatch.size
    }))
  }

  removeMappings(roomId: string, matchId: string): void {
    const hadRoomMapping = this.roomByMatch.delete(matchId)
    const hadMatchMapping = this.matchByRoom.delete(roomId)

    console.log(JSON.stringify({
      evt: 'gameRegistry.removeMappings',
      matchId,
      roomId,
      hadRoomMapping,
      hadMatchMapping,
      remainingMappings: this.roomByMatch.size
    }))
  }

  removeMappingsForMatch(matchId: string): void {
    const roomId = this.roomByMatch.get(matchId)
    if (roomId) {
      this.roomByMatch.delete(matchId)
      this.matchByRoom.delete(roomId)
    }
  }

  removeMappingsForRoom(roomId: string): void {
    const matchId = this.matchByRoom.get(roomId)
    if (matchId) {
      this.roomByMatch.delete(matchId)
      this.matchByRoom.delete(roomId)
    }
  }

  getAllMappings(): { roomId: string; matchId: string }[] {
    return Array.from(this.roomByMatch.entries()).map(([matchId, roomId]) => ({
      matchId,
      roomId
    }))
  }

  clear(): void {
    this.roomByMatch.clear()
    this.matchByRoom.clear()
    console.log(JSON.stringify({ evt: 'gameRegistry.cleared' }))
  }

  getStats(): { totalMappings: number; rooms: string[]; matches: string[] } {
    return {
      totalMappings: this.roomByMatch.size,
      rooms: Array.from(this.matchByRoom.keys()),
      matches: Array.from(this.roomByMatch.keys())
    }
  }
}

// Export singleton instance
export const GameRegistry = new GameRegistryClass()