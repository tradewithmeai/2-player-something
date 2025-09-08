import { Mutex } from 'async-mutex'
import { v4 as uuidv4 } from 'uuid'
import { GameRegistry } from './gameRegistry.js'

// Precomputed winning triplets (indices for 3x3 board)
const WINNING_LINES = [
  [0, 1, 2], // Top row
  [3, 4, 5], // Middle row
  [6, 7, 8], // Bottom row
  [0, 3, 6], // Left column
  [1, 4, 7], // Middle column
  [2, 5, 8], // Right column
  [0, 4, 8], // Diagonal top-left to bottom-right
  [2, 4, 6], // Diagonal top-right to bottom-left
]

export interface MatchState {
  id: string
  roomId: string
  board: (string | null)[] // 9 squares, null = empty, seat (P1/P2) = claimed
  players: string[] // [player1Id, player2Id]
  playerSeats: Map<string, 'P1' | 'P2'> // playerId -> seat mapping
  currentTurn: 'P1' | 'P2' // seat of current turn (not playerId)
  moves: Move[]
  version: number
  status: 'active' | 'finished'
  winner: 'P1' | 'P2' | 'draw' | null
  winningLine: number[] | null
  startedAt: Date
  finishedAt?: Date
}

export interface Move {
  playerId: string
  squareId: number
  selectionId: string
  timestamp: Date
}

export interface ClaimRequest {
  matchId: string
  squareId: number
  selectionId: string
  playerId: string
}

export interface ClaimResult {
  success: boolean
  reason?: 'invalid_square' | 'square_occupied' | 'not_your_turn' | 'match_finished' | 'duplicate_selection' | 'cap_reached' | 'stale_version'
  move?: Move
  matchState?: MatchState
  nextTurn?: 'P1' | 'P2'
}

export interface RateLimit {
  claims: { timestamp: Date; selectionId: string }[]
  acceptedClaims: number
}

export interface RematchRequest {
  matchId: string
  playerId: string
}

export interface RematchState {
  requests: Set<string> // playerIds who have requested rematch
  timeout: NodeJS.Timeout | null
  expires: Date
}

export class MatchService {
  private matches = new Map<string, MatchState>()
  private matchMutexes = new Map<string, Mutex>()
  private processedSelections = new Map<string, Set<string>>() // matchId -> Set of selectionIds
  private rateLimits = new Map<string, Map<string, RateLimit>>() // matchId -> playerId -> RateLimit
  private rematchStates = new Map<string, RematchState>() // matchId -> RematchState
  private matchMode = process.env.MATCH_MODE || 'turn'

  getMatchMode(): string {
    return this.matchMode
  }

  createMatch(roomId: string, players: string[]): MatchState {
    const matchId = `match_${Date.now()}_${uuidv4()}`
    
    // Deterministic seat assignment: first join = P1, second = P2
    const playerSeats = new Map<string, 'P1' | 'P2'>()
    playerSeats.set(players[0], 'P1')
    playerSeats.set(players[1], 'P2')
    
    const match: MatchState = {
      id: matchId,
      roomId,
      board: Array(9).fill(null),
      players: [...players],
      playerSeats,
      currentTurn: 'P1', // P1 always starts
      moves: [],
      version: 0,
      status: 'active',
      winner: null,
      winningLine: null,
      startedAt: new Date(),
      finishedAt: undefined
    }

    this.matches.set(matchId, match)
    this.matchMutexes.set(matchId, new Mutex())
    this.processedSelections.set(matchId, new Set())
    this.rateLimits.set(matchId, new Map())
    
    // Initialize rate limits for each player
    players.forEach(playerId => {
      this.rateLimits.get(matchId)!.set(playerId, {
        claims: [],
        acceptedClaims: 0,
      })
    })

    // Set atomic mapping in GameRegistry
    GameRegistry.setMatchRoom(matchId, roomId)
    
    // Assert mapping was set correctly
    if (!GameRegistry.getRoomIdForMatch(matchId)) {
      console.error(JSON.stringify({ 
        evt: 'match.creation.fatal', 
        matchId, 
        roomId,
        error: 'GameRegistry mapping failed'
      }))
      throw new Error('Failed to set match-room mapping')
    }

    console.log(JSON.stringify({
      evt: 'match.init',
      matchId, 
      roomId,
      winner: match.winner,
      finishedAt: match.finishedAt,
      version: match.version,
      moves: match.moves.length,
      status: match.status,
      starter: match.currentTurn,
      currentTurn: match.currentTurn
    }))
    return match
  }

  async claimSquare(request: ClaimRequest): Promise<ClaimResult> {
    const { matchId, squareId, selectionId, playerId } = request
    
    console.log(`[MatchService] Claim attempt`, {
      matchId,
      squareId,
      selectionId,
      playerId,
    })

    const match = this.matches.get(matchId)
    if (!match) {
      return { success: false, reason: 'match_finished' }
    }

    const mutex = this.matchMutexes.get(matchId)
    if (!mutex) {
      return { success: false, reason: 'match_finished' }
    }

    return await mutex.runExclusive(async () => {
      // Check if game is still active
      if (match.status !== 'active') {
        return { success: false, reason: 'match_finished' }
      }

      // Exactly-once result: no-op if winner already set or match finished (guardrail)
      if (match.winner !== null || match.finishedAt !== undefined) {
        return { success: false, reason: 'match_finished' }
      }

      // Check for duplicate selectionId (idempotency)
      const selections = this.processedSelections.get(matchId)!
      if (selections.has(selectionId)) {
        console.log(`[MatchService] Duplicate selection rejected: ${selectionId}`)
        return { success: false, reason: 'duplicate_selection' }
      }

      // Get player seat
      const playerSeat = match.playerSeats.get(playerId)
      if (!playerSeat) {
        this.logClaimDecision({ evt: 'claim', matchId, squareId, seat: null, reason: 'invalid_player', version: match.version })
        return { success: false, reason: 'match_finished' }
      }

      // Check rate limits
      if (!this.checkRateLimit(matchId, playerId)) {
        this.logClaimDecision({ evt: 'claim', matchId, squareId, seat: playerSeat, reason: 'cap_reached', version: match.version })
        return { success: false, reason: 'cap_reached' }
      }

      // Validate square ID
      if (squareId < 0 || squareId > 8) {
        this.logClaimDecision({ evt: 'claim', matchId, squareId, seat: playerSeat, reason: 'invalid_square', version: match.version })
        return { success: false, reason: 'invalid_square' }
      }

      // Check if square is already claimed
      if (match.board[squareId] !== null) {
        this.logClaimDecision({ evt: 'claim', matchId, squareId, seat: playerSeat, reason: 'square_occupied', version: match.version })
        return { success: false, reason: 'square_occupied' }
      }

      // Check if it's the player's turn (seat-based)
      if (match.currentTurn !== playerSeat) {
        this.logClaimDecision({ evt: 'claim', matchId, squareId, seat: playerSeat, reason: 'not_your_turn', version: match.version })
        return { success: false, reason: 'not_your_turn' }
      }

      // Make the move
      match.board[squareId] = playerSeat // Store seat (P1/P2) not playerId
      match.version++
      selections.add(selectionId)

      const move: Move = {
        playerId,
        squareId,
        selectionId,
        timestamp: new Date(),
      }
      match.moves.push(move)

      // Update rate limit
      this.updateRateLimit(matchId, playerId, selectionId)

      // Switch turns (seat-based)
      match.currentTurn = match.currentTurn === 'P1' ? 'P2' : 'P1'

      // Check for win
      const winResult = this.checkWin(match, playerSeat)
      if (winResult.won) {
        match.status = 'finished'
        match.winner = playerSeat
        match.winningLine = winResult.line || null
        match.finishedAt = new Date()
        this.logClaimDecision({ evt: 'claim', matchId, squareId, seat: playerSeat, version: match.version, result: 'win' })
      } else if (match.moves.length === 9) {
        // Check for draw
        match.status = 'finished'
        match.winner = 'draw'
        match.finishedAt = new Date()
        this.logClaimDecision({ evt: 'claim', matchId, squareId, seat: playerSeat, version: match.version, result: 'draw' })
      } else {
        this.logClaimDecision({ evt: 'claim', matchId, squareId, seat: playerSeat, version: match.version })
      }

      return {
        success: true,
        move,
        matchState: { ...match },
        nextTurn: match.status === 'active' ? match.currentTurn : undefined,
      }
    })
  }

  private checkWin(match: MatchState, seat: 'P1' | 'P2'): { won: boolean; line?: number[] } {
    for (const line of WINNING_LINES) {
      if (line.every(index => match.board[index] === seat)) {
        return { won: true, line }
      }
    }
    return { won: false }
  }

  private checkRateLimit(matchId: string, playerId: string): boolean {
    const matchLimits = this.rateLimits.get(matchId)
    if (!matchLimits) return false

    const playerLimit = matchLimits.get(playerId)
    if (!playerLimit) return false

    // Check accepted claims cap (8 per player)
    if (playerLimit.acceptedClaims >= 8) {
      return false
    }

    // Check rate limit (10 claims per 10 seconds)
    const now = new Date()
    const tenSecondsAgo = new Date(now.getTime() - 10000)
    
    // Remove old claims
    playerLimit.claims = playerLimit.claims.filter(
      claim => claim.timestamp > tenSecondsAgo
    )

    // Check if under limit
    return playerLimit.claims.length < 10
  }

  private updateRateLimit(matchId: string, playerId: string, selectionId: string): void {
    const matchLimits = this.rateLimits.get(matchId)
    if (!matchLimits) return

    const playerLimit = matchLimits.get(playerId)
    if (!playerLimit) return

    playerLimit.claims.push({
      timestamp: new Date(),
      selectionId,
    })
    playerLimit.acceptedClaims++
  }

  private logClaimDecision(params: {
    evt: 'claim'
    matchId: string
    squareId: number
    seat: 'P1' | 'P2' | null
    version: number
    reason?: string
    result?: 'win' | 'draw'
  }): void {
    console.log(JSON.stringify({
      evt: params.evt,
      matchId: params.matchId,
      seat: params.seat,
      squareId: params.squareId,
      version: params.version,
      ...(params.reason && { reason: params.reason }),
      ...(params.result && { result: params.result }),
      timestamp: new Date().toISOString(),
    }))
  }

  getMatch(matchId: string): MatchState | undefined {
    return this.matches.get(matchId)
  }

  validateVersion(matchId: string, version: number): boolean {
    const match = this.matches.get(matchId)
    if (!match) return false
    return match.version === version
  }

  async requestRematch(request: RematchRequest): Promise<{ type: 'waiting' | 'matched', newMatchId?: string }> {
    const { matchId, playerId } = request
    
    const match = this.matches.get(matchId)
    if (!match || match.status !== 'finished') {
      return { type: 'waiting' } // Invalid state, ignore
    }

    // Check if player is in the match
    if (!match.players.includes(playerId)) {
      return { type: 'waiting' }
    }

    const mutex = this.matchMutexes.get(matchId)
    if (!mutex) {
      return { type: 'waiting' }
    }

    return await mutex.runExclusive(async () => {
      let rematchState = this.rematchStates.get(matchId)
      
      if (!rematchState) {
        // Create new rematch state
        const expires = new Date(Date.now() + 60000) // 60s timeout
        rematchState = {
          requests: new Set([playerId]),
          timeout: setTimeout(() => {
            this.rematchStates.delete(matchId)
            console.log(JSON.stringify({ evt: 'rematch.timeout', matchId }))
          }, 60000),
          expires
        }
        this.rematchStates.set(matchId, rematchState)
        
        console.log(JSON.stringify({ evt: 'rematch.request', matchId, playerId, expires: expires.toISOString() }))
        return { type: 'waiting' }
      }

      // Add player to existing rematch state
      rematchState.requests.add(playerId)
      
      // Check if both players have requested
      if (rematchState.requests.size === 2) {
        // Clear timeout
        if (rematchState.timeout) {
          clearTimeout(rematchState.timeout)
        }
        this.rematchStates.delete(matchId)
        
        // Flip starter: whoever was P2 becomes P1
        const originalPlayers = [...match.players]
        const flippedPlayers = [originalPlayers[1], originalPlayers[0]]
        
        // Create new match with flipped starter
        const newMatch = this.createMatch(match.roomId, flippedPlayers)
        
        console.log(JSON.stringify({
          evt: 'rematch.start',
          oldMatchId: matchId,
          newMatchId: newMatch.id,
          starter: 'P1' // First player in flipped array becomes P1
        }))
        
        return { type: 'matched', newMatchId: newMatch.id }
      }
      
      console.log(JSON.stringify({ evt: 'rematch.waiting', matchId, playerId }))
      return { type: 'waiting' }
    })
  }

  cleanupMatch(matchId: string): void {
    const match = this.matches.get(matchId)
    if (match) {
      // Remove GameRegistry mapping
      GameRegistry.removeMappings(match.roomId, matchId)
    }
    
    // Clean up rematch state
    const rematchState = this.rematchStates.get(matchId)
    if (rematchState?.timeout) {
      clearTimeout(rematchState.timeout)
    }
    this.rematchStates.delete(matchId)
    
    this.matches.delete(matchId)
    this.matchMutexes.delete(matchId)
    this.processedSelections.delete(matchId)
    this.rateLimits.delete(matchId)
    
    console.log(JSON.stringify({
      evt: 'match.cleanup',
      matchId,
      roomId: match?.roomId || 'unknown'
    }))
  }

  // Debug methods
  getActiveMatchCount(): number {
    return Array.from(this.matches.values()).filter(m => m.status === 'active').length
  }

  getFinishedMatchCount(): number {
    return Array.from(this.matches.values()).filter(m => m.status === 'finished').length
  }

  getActiveMatches(): MatchState[] {
    return Array.from(this.matches.values()).filter(m => m.status === 'active')
  }
}