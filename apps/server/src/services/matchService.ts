import { Mutex } from 'async-mutex'
import { v4 as uuidv4 } from 'uuid'
import { GameRegistry } from './gameRegistry.js'
import { GameEngine } from '../engine/types.js'
import { TicTacToeEngine } from '../engine/tictactoeEngine.js'
import { GameOfStrifeEngine } from '../engine/gameOfStrifeEngine.js'

// Note: Winning line logic now handled by GameEngine

export interface MatchState {
  id: string
  roomId: string
  board: (string | null)[] // Flattened board representation for compatibility
  players: string[] // [player1Id, player2Id]
  playerSeats: Map<string, 'P1' | 'P2'> // playerId -> seat mapping
  currentTurn: 'P1' | 'P2' | null // seat of current turn (not playerId), null when finished
  moves: Move[]
  version: number
  status: 'active' | 'finished'
  winner: 'P1' | 'P2' | 'draw' | null
  winningLine: number[] | null
  startedAt: Date
  finishedAt?: Date
  // Simul mode specific
  mode: 'turn' | 'simul'
  currentWindowId?: number
  currentWindowStarter?: 'P1' | 'P2'
  windowTimeout?: NodeJS.Timeout
  // Engine-specific state storage
  engineState?: any // Store the full engine state separately
  gameType: 'tictactoe' | 'gameofstrife' | 'backgammon' // Game type identifier
  // Game-specific metadata for frontend consumption
  metadata?: any
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

// Simultaneous mode interfaces
export interface PendingClaim {
  playerId: string
  seat: 'P1' | 'P2'
  selectionId: string
  squareId: number
  timestamp: Date
}

export interface WindowResult {
  applied: Array<{ seat: 'P1' | 'P2', squareId: number, version: number }>
  rejected: Array<{ seat: 'P1' | 'P2', squareId: number, reason: string, version: number }>
}

export interface WindowOpenData {
  matchId: string
  windowId: number
  starterSeat: 'P1' | 'P2'
  deadlineTs: number
}

export interface WindowCloseData {
  matchId: string
  windowId: number
  applied: Array<{ seat: 'P1' | 'P2', squareId: number, version: number }>
  rejected: Array<{ seat: 'P1' | 'P2', squareId: number, reason: string, version: number }>
}

export class MatchService {
  private matches = new Map<string, MatchState>()
  private matchMutexes = new Map<string, Mutex>()
  private processedSelections = new Map<string, Set<string>>() // matchId -> Set of selectionIds
  private rateLimits = new Map<string, Map<string, RateLimit>>() // matchId -> playerId -> RateLimit
  private rematchStates = new Map<string, RematchState>() // matchId -> RematchState
  private matchMode = process.env.MATCH_MODE || 'turn'
  private engine: GameEngine
  
  // Simul mode specific
  private pendingClaimBuffers = new Map<string, Map<'P1' | 'P2', PendingClaim>>() // matchId -> seat -> PendingClaim
  private windowCounters = new Map<string, number>() // matchId -> windowId counter
  private simulWindowMs = parseInt(process.env.SIMUL_WINDOW_MS || '500', 10)
  private simulStarterAlternation = process.env.SIMUL_STARTER_ALTERNATION === 'true'
  private gameType: 'tictactoe' | 'gameofstrife' | 'backgammon'

  constructor() {
    // Initialize engine based on ENGINE_KIND (default to tictactoe)
    const engineKind = process.env.ENGINE_KIND || 'tictactoe'

    // Debug logging
    console.log('DEBUG: ENGINE_KIND env var:', process.env.ENGINE_KIND)
    console.log('DEBUG: Resolved engineKind:', engineKind)

    if (engineKind === 'tictactoe') {
      this.engine = new TicTacToeEngine()
      this.gameType = 'tictactoe'
    } else if (engineKind === 'gameofstrife') {
      this.engine = new GameOfStrifeEngine()
      this.gameType = 'gameofstrife'
    } else {
      // Default to tictactoe for any unknown engine types
      this.engine = new TicTacToeEngine()
      this.gameType = 'tictactoe'
    }

    // Log engine selection
    console.log(JSON.stringify({
      evt: 'engine.selected',
      kind: engineKind
    }))
  }

  getMatchMode(): string {
    return this.matchMode
  }

  getDebugInfo(matchId: string): { pendingClaims: Record<string, any> } | null {
    const match = this.matches.get(matchId)
    if (!match) return null

    const buffer = this.pendingClaimBuffers.get(matchId)
    const pendingClaims: Record<string, any> = {}
    
    if (buffer) {
      for (const [seat, claim] of buffer.entries()) {
        pendingClaims[seat] = {
          selectionId: claim.selectionId,
          squareId: claim.squareId,
          timestamp: claim.timestamp.toISOString()
        }
      }
    }

    return { pendingClaims }
  }

  createMatch(roomId: string, players: string[]): MatchState {
    const matchId = `match_${Date.now()}_${uuidv4()}`
    
    // Deterministic seat assignment: first join = P1, second = P2
    const playerSeats = new Map<string, 'P1' | 'P2'>()
    playerSeats.set(players[0], 'P1')
    playerSeats.set(players[1], 'P2')
    
    // Initialize game state using engine
    const engineState = this.engine.initState()
    const extendedEngineState = engineState as any

    const match: MatchState = {
      id: matchId,
      roomId,
      board: engineState.board,
      players: [...players],
      playerSeats,
      currentTurn: engineState.currentTurn,
      moves: [],
      version: engineState.version,
      status: 'active',
      mode: this.matchMode as 'turn' | 'simul',
      winner: engineState.winner,
      winningLine: engineState.winningLine,
      startedAt: new Date(),
      finishedAt: engineState.finishedAt,
      gameType: this.gameType, // Include game type in match state
      engineState: extendedEngineState.engineState || engineState // Store full engine state
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
    
    // Initialize simul mode specific data structures
    if (this.matchMode === 'simul') {
      this.pendingClaimBuffers.set(matchId, new Map())
      this.windowCounters.set(matchId, 0)
      match.currentWindowId = 0
      match.currentWindowStarter = 'P1'
    }

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
        // Log post-finish claim rejection  
        console.log(JSON.stringify({
          evt: 'claim.reject',
          reason: 'match_finished',
          matchId,
          squareId
        }))
        return { success: false, reason: 'match_finished' }
      }

      // Exactly-once result: no-op if winner already set or match finished (guardrail)
      if (match.winner !== null || match.finishedAt !== undefined) {
        // Log post-finish claim rejection
        console.log(JSON.stringify({
          evt: 'claim.reject',
          reason: 'match_finished',
          matchId,
          squareId,
          currentStatus: match.status,
          currentWinner: match.winner,
          finishedAt: match.finishedAt?.toISOString()
        }))
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

      // Use stored engine state or create minimal state for validation
      const engineState = match.engineState || {
        board: match.board,
        currentTurn: match.currentTurn,
        winner: match.winner,
        winningLine: match.winningLine,
        version: match.version,
        finishedAt: match.finishedAt
      }
      
      // Use engine validation but handle mode-specific logic
      const validation = this.engine.validateClaim(engineState, playerSeat, squareId)
      if (!validation.valid) {
        // Skip 'not_your_turn' validation for simul mode (handled differently)
        if (validation.reason === 'not_your_turn' && match.mode === 'simul') {
          // Allow the claim to proceed for simul mode buffering
        } else {
          this.logClaimDecision({ evt: 'claim', matchId, squareId, seat: playerSeat, reason: validation.reason!, version: match.version })
          return { success: false, reason: validation.reason! }
        }
      }

      // Handle mode-specific logic
      if (match.mode === 'simul') {
        // In simul mode, add to pending claim buffer instead of immediately applying
        return this.handleSimulClaim(match, request, playerSeat)
      } else {
        // Turn-based mode
        return this.handleTurnBasedClaim(match, request, playerSeat, selections)
      }
    })
  }

  private handleTurnBasedClaim(match: MatchState, request: ClaimRequest, playerSeat: 'P1' | 'P2', selections: Set<string>): ClaimResult {
    const { matchId, squareId, selectionId, playerId } = request

    // Use stored engine state or create minimal state
    const engineState = match.engineState || {
      board: match.board,
      currentTurn: match.currentTurn,
      winner: match.winner,
      winningLine: match.winningLine,
      version: match.version,
      finishedAt: match.finishedAt
    }

    // Validate claim using engine
    const validation = this.engine.validateClaim(engineState, playerSeat, squareId)
    if (!validation.valid) {
      this.logClaimDecision({ evt: 'claim', matchId, squareId, seat: playerSeat, reason: validation.reason!, version: match.version })
      return { success: false, reason: validation.reason! }
    }

    // Apply claim using engine
    const claimApplication = this.engine.applyClaim(engineState, playerSeat, squareId)

    // Update match state with engine results
    match.board = claimApplication.board
    match.version = claimApplication.version
    match.currentTurn = claimApplication.nextTurn

    // Update stored engine state if available
    if (claimApplication.engineState) {
      // Use the full engine state returned by the engine
      match.engineState = claimApplication.engineState
    } else if (match.engineState) {
      // Fallback: update basic fields only
      match.engineState.version = claimApplication.version
      match.engineState.currentTurn = claimApplication.nextTurn
    }

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

    // Check for game result using engine
    const updatedEngineState = match.engineState || {
      board: claimApplication.board,
      currentTurn: claimApplication.nextTurn,
      winner: match.winner,
      winningLine: match.winningLine,
      version: claimApplication.version,
      finishedAt: match.finishedAt
    }
    const gameResult = this.engine.checkResult(updatedEngineState)
    if (gameResult.status === 'finished') {
      // Set match state BEFORE emitting any events
      match.status = 'finished'
      match.winner = gameResult.winner!
      match.winningLine = gameResult.winningLine || null
      match.finishedAt = new Date()
      match.currentTurn = null // Set to null when finished
      
      // Log result.decided for structured logging
      console.log(JSON.stringify({
        evt: 'result.decided',
        matchId,
        winner: gameResult.winner!,
        line: gameResult.winningLine || null,
        version: match.version,
        finishedAt: match.finishedAt.toISOString()
      }))
      
      const resultType = gameResult.winner === 'draw' ? 'draw' : 'win'
      this.logClaimDecision({ evt: 'claim', matchId, squareId, seat: playerSeat, version: match.version, result: resultType })
    } else {
      this.logClaimDecision({ evt: 'claim', matchId, squareId, seat: playerSeat, version: match.version })
    }

    // Prepare match state with Game of Strife metadata if applicable
    const matchStateToReturn = this.enrichMatchStateWithMetadata({ ...match })

    return {
      success: true,
      move,
      matchState: matchStateToReturn,
      nextTurn: match.status === 'active' && match.currentTurn ? match.currentTurn : undefined,
    }
  }

  private handleSimulClaim(match: MatchState, request: ClaimRequest, playerSeat: 'P1' | 'P2'): ClaimResult {
    const { matchId, squareId, selectionId, playerId } = request

    // Add to pending claim buffer (last submitted wins per seat)
    const buffer = this.pendingClaimBuffers.get(matchId)!
    buffer.set(playerSeat, {
      playerId,
      seat: playerSeat,
      selectionId,
      squareId,
      timestamp: new Date()
    })

    // Update rate limit
    this.updateRateLimit(matchId, playerId, selectionId)

    // Log claim received
    console.log(JSON.stringify({
      evt: 'window.collect',
      matchId,
      windowId: match.currentWindowId,
      seat: playerSeat,
      squareId,
      selectionId,
      timestamp: new Date().toISOString()
    }))

    // Return success (claim is buffered, not immediately applied)
    return {
      success: true,
      move: {
        playerId,
        squareId,
        selectionId,
        timestamp: new Date()
      },
      matchState: this.enrichMatchStateWithMetadata({ ...match })
    }
  }

  // Method to be called by the main game loop to open a new simul window
  openSimulWindow(matchId: string, onWindowClose?: (matchId: string, roomId: string) => void): WindowOpenData | null {
    const match = this.matches.get(matchId)
    if (!match || match.mode !== 'simul' || match.status !== 'active') {
      return null
    }

    // Increment window ID
    const windowId = this.windowCounters.get(matchId)! + 1
    this.windowCounters.set(matchId, windowId)
    match.currentWindowId = windowId

    // Determine starter (alternating if configured)
    const starterSeat = this.simulStarterAlternation && windowId % 2 === 0 ? 'P2' : 'P1'
    match.currentWindowStarter = starterSeat

    const deadlineTs = Date.now() + this.simulWindowMs

    console.log(JSON.stringify({
      evt: 'window.open',
      matchId,
      windowId,
      starterSeat,
      deadlineTs,
      duration: this.simulWindowMs
    }))

    // Clear previous window's buffer
    this.pendingClaimBuffers.get(matchId)!.clear()

    // Set timeout to close window
    if (match.windowTimeout) {
      clearTimeout(match.windowTimeout)
    }

    match.windowTimeout = setTimeout(() => {
      if (onWindowClose) {
        onWindowClose(matchId, match.roomId)
      } else {
        this.closeSimulWindow(matchId)
      }
    }, this.simulWindowMs)

    return {
      matchId,
      windowId,
      starterSeat,
      deadlineTs
    }
  }

  // Method to close the current simul window and resolve conflicts
  closeSimulWindow(matchId: string): WindowCloseData | null {
    const match = this.matches.get(matchId)
    if (!match || match.mode !== 'simul' || match.status !== 'active') {
      return null
    }

    const buffer = this.pendingClaimBuffers.get(matchId)!
    const windowId = match.currentWindowId!
    const selections = this.processedSelections.get(matchId)!

    console.log(JSON.stringify({
      evt: 'window.resolve',
      matchId,
      windowId,
      pendingClaims: Array.from(buffer.entries()).map(([seat, claim]) => ({
        seat,
        squareId: claim.squareId,
        selectionId: claim.selectionId
      }))
    }))

    const result = this.resolveWindowConflicts(match, buffer, selections)

    console.log(JSON.stringify({
      evt: 'window.apply',
      matchId,
      windowId,
      applied: result.applied,
      rejected: result.rejected
    }))

    console.log(JSON.stringify({
      evt: 'window.close',
      matchId,
      windowId,
      applied: result.applied.length,
      rejected: result.rejected.length
    }))

    // Clear timeout and buffer
    if (match.windowTimeout) {
      clearTimeout(match.windowTimeout)
      match.windowTimeout = undefined
    }
    buffer.clear()

    return {
      matchId,
      windowId,
      applied: result.applied,
      rejected: result.rejected
    }
  }

  private resolveWindowConflicts(match: MatchState, buffer: Map<'P1' | 'P2', PendingClaim>, selections: Set<string>): WindowResult {
    const applied: Array<{ seat: 'P1' | 'P2', squareId: number, version: number }> = []
    const rejected: Array<{ seat: 'P1' | 'P2', squareId: number, reason: string, version: number }> = []

    // Get claims from buffer
    const claims = Array.from(buffer.values())
    if (claims.length === 0) {
      return { applied, rejected }
    }

    // Group claims by square
    const claimsBySquare = new Map<number, PendingClaim[]>()
    for (const claim of claims) {
      if (!claimsBySquare.has(claim.squareId)) {
        claimsBySquare.set(claim.squareId, [])
      }
      claimsBySquare.get(claim.squareId)!.push(claim)
    }

    // Process each square
    for (const [squareId, squareClaims] of claimsBySquare.entries()) {
      // Check if square is already occupied
      if (match.board[squareId] !== null) {
        // Reject all claims for occupied square
        for (const claim of squareClaims) {
          rejected.push({
            seat: claim.seat,
            squareId: claim.squareId,
            reason: 'square_occupied',
            version: match.version
          })
        }
        continue
      }

      if (squareClaims.length === 1) {
        // Single claim: apply it
        const claim = squareClaims[0]
        this.applySingleClaim(match, claim, selections)
        applied.push({
          seat: claim.seat,
          squareId: claim.squareId,
          version: match.version
        })
      } else {
        // Multiple claims for same square: apply one, reject others
        const winnerClaim = this.selectWinnerClaim(squareClaims, match.currentWindowStarter!)
        
        // Apply winner
        this.applySingleClaim(match, winnerClaim, selections)
        applied.push({
          seat: winnerClaim.seat,
          squareId: winnerClaim.squareId,
          version: match.version
        })

        // Reject others
        for (const claim of squareClaims) {
          if (claim !== winnerClaim) {
            rejected.push({
              seat: claim.seat,
              squareId: claim.squareId,
              reason: 'conflict_lost',
              version: match.version
            })
          }
        }
      }
    }

    // Check for win/draw after all applications
    this.checkMatchFinish(match)

    return { applied, rejected }
  }

  private selectWinnerClaim(claims: PendingClaim[], currentWindowStarter: 'P1' | 'P2'): PendingClaim {
    // Sort by timestamp (earlier wins)
    claims.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    
    const earliest = claims[0]
    
    // If there's a clear timestamp winner, use it
    if (claims.length === 1 || claims[1].timestamp.getTime() > earliest.timestamp.getTime()) {
      return earliest
    }

    // Tie-breaker: current window starter wins
    const starterClaim = claims.find(c => c.seat === currentWindowStarter)
    return starterClaim || earliest
  }

  private applySingleClaim(match: MatchState, claim: PendingClaim, selections: Set<string>): void {
    // Apply the claim
    match.board[claim.squareId] = claim.seat
    match.version++
    selections.add(claim.selectionId)

    const move: Move = {
      playerId: claim.playerId,
      squareId: claim.squareId,
      selectionId: claim.selectionId,
      timestamp: claim.timestamp,
    }
    match.moves.push(move)

    this.logClaimDecision({ 
      evt: 'claim', 
      matchId: match.id, 
      squareId: claim.squareId, 
      seat: claim.seat, 
      version: match.version 
    })
  }

  private checkMatchFinish(match: MatchState): void {
    // Use engine to check game result
    const engineState = {
      board: match.board,
      currentTurn: match.currentTurn,
      winner: match.winner,
      winningLine: match.winningLine,
      version: match.version,
      finishedAt: match.finishedAt
    }
    
    const gameResult = this.engine.checkResult(engineState)
    if (gameResult.status === 'finished') {
      // Set match state BEFORE emitting any events
      match.status = 'finished'
      match.winner = gameResult.winner!
      match.winningLine = gameResult.winningLine || null
      match.finishedAt = new Date()
      match.currentTurn = null // Set to null when finished
      
      console.log(JSON.stringify({
        evt: 'result.decided',
        matchId: match.id,
        winner: gameResult.winner!,
        line: gameResult.winningLine || null,
        version: match.version,
        finishedAt: match.finishedAt.toISOString()
      }))
      return
    }

    // If not finished but would be draw case, handle it (this check should not be needed with proper engine)
    if (match.moves.length === 9) {
      // Set match state BEFORE emitting any events
      match.status = 'finished'
      match.winner = 'draw'
      match.finishedAt = new Date()
      match.currentTurn = null // Set to null when finished
      
      console.log(JSON.stringify({
        evt: 'result.decided',
        matchId: match.id,
        winner: 'draw',
        line: null,
        version: match.version,
        finishedAt: match.finishedAt.toISOString()
      }))
    }
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

  async requestRematch(request: RematchRequest): Promise<{ type: 'waiting' | 'matched' | 'timeout', newMatchId?: string }> {
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

  /**
   * Enriches match state with game-specific metadata for frontend consumption
   */
  private enrichMatchStateWithMetadata(matchState: MatchState): MatchState {
    // For Game of Strife, add metadata that frontend bridge expects
    if (matchState.gameType === 'gameofstrife' && matchState.engineState) {
      const engineState = matchState.engineState as any

      // Extract Game of Strife specific data from engine state
      const metadata = {
        stage: engineState.currentPhase || 'placement',
        generation: engineState.generation || 0,
        playerTokens: engineState.playerTokens || {
          player0: 10, // Default token count
          player1: 10
        },
        boardSize: engineState.boardSize || 20,
        simulationSpeed: engineState.simulationSpeed || 200,
        simulationRunning: engineState.simulationRunning || false
      }

      // Add metadata to match state
      return {
        ...matchState,
        metadata
      }
    }

    // For other game types, return as-is
    return matchState
  }
}