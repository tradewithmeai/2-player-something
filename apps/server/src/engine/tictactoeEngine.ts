import { GameEngine, EngineState, ValidationResult, ClaimApplication, ResultCheck } from './types.js'

// Precomputed winning triplets (indices for 3x3 board) - copied from MatchService
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

export class TicTacToeEngine implements GameEngine {
  
  initState(): EngineState {
    return {
      board: Array(9).fill(null),
      currentTurn: 'P1', // P1 always starts
      winner: null,
      winningLine: null,
      version: 0,
      finishedAt: undefined
    }
  }

  validateClaim(state: EngineState, seat: 'P1' | 'P2', squareId: number): ValidationResult {
    // Check if match is finished
    if (state.winner !== null || state.finishedAt !== undefined) {
      return { valid: false, reason: 'match_finished' }
    }

    // Validate square ID (0-8 for 3x3 board)
    if (squareId < 0 || squareId > 8) {
      return { valid: false, reason: 'invalid_square' }
    }

    // Check if square is already occupied
    if (state.board[squareId] !== null) {
      return { valid: false, reason: 'square_occupied' }
    }

    // Check if it's the player's turn (for turn-based mode validation)
    if (state.currentTurn !== seat) {
      return { valid: false, reason: 'not_your_turn' }
    }

    return { valid: true }
  }

  applyClaim(state: EngineState, seat: 'P1' | 'P2', squareId: number): ClaimApplication {
    // Create new board state with the claim applied
    const newBoard = [...state.board]
    newBoard[squareId] = seat

    // Increment version
    const newVersion = state.version + 1

    // Calculate next turn (switch between P1 and P2)
    const nextTurn = seat === 'P1' ? 'P2' : 'P1'

    return {
      board: newBoard,
      version: newVersion,
      nextTurn
    }
  }

  checkResult(state: EngineState): ResultCheck {
    // First check for wins
    for (const seat of ['P1', 'P2'] as const) {
      const winResult = this.checkWin(state, seat)
      if (winResult.isWin) {
        return {
          status: 'finished',
          winner: seat,
          winningLine: winResult.line
        }
      }
    }

    // Check for draw (all squares filled, no winner)
    const filledSquares = state.board.filter(square => square !== null).length
    if (filledSquares === 9) {
      return {
        status: 'finished',
        winner: 'draw'
      }
    }

    // Game is still active
    return {
      status: 'active'
    }
  }

  private checkWin(state: EngineState, seat: 'P1' | 'P2'): { isWin: boolean; line?: number[] } {
    for (const line of WINNING_LINES) {
      if (line.every(index => state.board[index] === seat)) {
        return { isWin: true, line }
      }
    }
    return { isWin: false }
  }
}