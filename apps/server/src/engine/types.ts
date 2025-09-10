// Engine abstraction types - matches existing MatchState structure
export interface EngineState {
  board: (string | null)[]  // 9 squares for tic-tac-toe
  currentTurn: 'P1' | 'P2' | null
  winner: 'P1' | 'P2' | 'draw' | null
  winningLine: number[] | null
  version: number
  finishedAt?: Date
}

export interface ValidationResult {
  valid: boolean
  reason?: 'invalid_square' | 'square_occupied' | 'not_your_turn' | 'match_finished'
}

export interface ClaimApplication {
  board: (string | null)[]
  version: number
  nextTurn: 'P1' | 'P2' | null
}

export interface WinCheckResult {
  isWin: boolean
  line?: number[]
}

export interface ResultCheck {
  status: 'active' | 'finished'
  winner?: 'P1' | 'P2' | 'draw'
  winningLine?: number[]
}

// Main engine interface
export interface GameEngine {
  // Initialize a new game state
  initState(): EngineState
  
  // Validate if a claim is legal
  validateClaim(state: EngineState, seat: 'P1' | 'P2', squareId: number): ValidationResult
  
  // Apply a validated claim and return the mutation
  applyClaim(state: EngineState, seat: 'P1' | 'P2', squareId: number): ClaimApplication
  
  // Check for win/draw after a move
  checkResult(state: EngineState): ResultCheck
}