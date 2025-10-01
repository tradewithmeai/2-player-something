import { GameEngine, EngineState, ValidationResult, ClaimApplication, ResultCheck } from './types.js'
import {
  GameOfStrifeEngineState,
  GameOfStrifeSettings,
  DEFAULT_GAME_SETTINGS,
  Cell,
  MemoryFlags,
  createBoard,
  isValidPosition,
  countLivingCells,
  indexToPosition
} from './gameOfStrifeTypes.js'

export class GameOfStrifeEngine implements GameEngine {
  private settings: GameOfStrifeSettings

  constructor(settings: Partial<GameOfStrifeSettings> = {}) {
    this.settings = { ...DEFAULT_GAME_SETTINGS, ...settings }
  }

  initState(): EngineState {
    const board = createBoard(this.settings.boardSize)

    // Create flattened board for MatchState compatibility
    const flatBoard = this.flattenBoard(board)

    const gameOfStrifeState: GameOfStrifeEngineState = {
      // Base EngineState properties - use 2D board for internal storage
      board: board,
      currentTurn: 'P1',
      winner: null,
      winningLine: null,
      version: 0,
      finishedAt: undefined,

      // Game of Strife specific properties
      currentPhase: 'placement',
      generation: 0,
      boardSize: this.settings.boardSize,
      conwayRules: this.settings.conwayRules,
      playerTokens: {
        player0: this.settings.tokensPerPlayer,
        player1: this.settings.tokensPerPlayer
      },
      placements: []
    }

    // Return compatible EngineState with flattened board
    const baseState: EngineState = {
      board: flatBoard,
      currentTurn: gameOfStrifeState.currentTurn,
      winner: gameOfStrifeState.winner,
      winningLine: gameOfStrifeState.winningLine,
      version: gameOfStrifeState.version,
      finishedAt: gameOfStrifeState.finishedAt
    }

    // Add the full Game of Strife state for storage
    return {
      ...baseState,
      engineState: gameOfStrifeState
    } as EngineState & { engineState: GameOfStrifeEngineState }
  }

  validateClaim(state: EngineState, seat: 'P1' | 'P2', squareId: number): ValidationResult {
    const gosState = state as unknown as GameOfStrifeEngineState


    // Check if match is finished
    if (gosState.winner !== null || gosState.finishedAt !== undefined) {
      return { valid: false, reason: 'match_finished' }
    }

    // If GameOfStrife state is not available, treat as basic game
    if (!('currentPhase' in gosState)) {
      // This is likely a basic EngineState, so treat it as always valid for placement

      // Basic validation for non-GameOfStrife state
      if (squareId < 0 || squareId >= (state.board as any[]).length) {
        return { valid: false, reason: 'invalid_square' }
      }

      // For basic state, check if position is occupied
      if (state.board[squareId] !== null) {
        return { valid: false, reason: 'square_occupied' }
      }

      // Check turns for basic state
      if (state.currentTurn !== seat) {
        return { valid: false, reason: 'not_your_turn' }
      }

      return { valid: true }
    }

    // Check if we're in placement phase
    if (gosState.currentPhase !== 'placement') {
      return { valid: false, reason: 'match_finished' } // Using existing reason
    }

    // Convert squareId to row/col position
    const { row, col } = indexToPosition(squareId, gosState.boardSize)

    // Validate position bounds
    if (!isValidPosition(row, col, gosState.boardSize)) {
      return { valid: false, reason: 'invalid_square' }
    }

    // Check if square is already occupied
    if (gosState.board[row][col].player !== null) {
      return { valid: false, reason: 'square_occupied' }
    }

    // Check if it's the player's turn (for turn-based placement)
    if (gosState.currentTurn !== seat) {
      return { valid: false, reason: 'not_your_turn' }
    }

    // Check if player has tokens remaining
    const playerIndex = seat === 'P1' ? 0 : 1
    const tokensKey = playerIndex === 0 ? 'player0' : 'player1'
    if (gosState.playerTokens[tokensKey] <= 0) {
      return { valid: false, reason: 'invalid_square' } // No more tokens
    }

    return { valid: true }
  }

  applyClaim(state: EngineState, seat: 'P1' | 'P2', squareId: number): ClaimApplication {
    const gosState = state as unknown as GameOfStrifeEngineState
    const playerIndex = seat === 'P1' ? 0 : 1

    // Handle both GameOfStrife state and basic EngineState
    let newBoard: Cell[][]
    let boardSize: number

    if ('currentPhase' in gosState && gosState.board && Array.isArray(gosState.board[0])) {
      // This is a proper GameOfStrife state with 2D board
      boardSize = gosState.boardSize
      newBoard = gosState.board.map(row => row.map(cell => ({ ...cell })))
    } else {
      // This is a basic EngineState with flattened board, reconstruct 2D board
      boardSize = this.settings.boardSize
      newBoard = createBoard(boardSize)

      // Populate from flattened board
      const flatBoard = state.board as (string | null)[]
      for (let i = 0; i < flatBoard.length; i++) {
        const { row, col } = indexToPosition(i, boardSize)
        if (flatBoard[i] !== null) {
          newBoard[row][col] = {
            player: flatBoard[i] === 'P1' ? 0 : 1,
            alive: true,
            superpowerType: 0,
            memory: 0
          }
        }
      }
    }

    const { row, col } = indexToPosition(squareId, boardSize)
    newBoard[row][col] = {
      player: playerIndex,
      alive: true, // Placed tokens start alive
      superpowerType: 0, // Default to normal type for now
      memory: 0
    }

    // Handle token counting and phase management
    let nextTurn: 'P1' | 'P2' | null
    let shouldStartSimulation = false

    if ('currentPhase' in gosState && gosState.playerTokens) {
      // Update token count for GameOfStrife state
      const newPlayerTokens = { ...gosState.playerTokens }
      const tokensKey = playerIndex === 0 ? 'player0' : 'player1'
      newPlayerTokens[tokensKey]--

      // Check if placement phase should end
      const totalTokensRemaining = newPlayerTokens.player0 + newPlayerTokens.player1
      shouldStartSimulation = totalTokensRemaining === 0

      if (shouldStartSimulation) {
        nextTurn = null // No more turns during simulation
      } else {
        nextTurn = seat === 'P1' ? 'P2' : 'P1'
      }
    } else {
      // For basic state, just switch turns
      nextTurn = seat === 'P1' ? 'P2' : 'P1'
    }

    // Create updated Game of Strife state
    const updatedGoSState: GameOfStrifeEngineState = {
      ...gosState,
      board: newBoard,
      version: state.version + 1,
      currentTurn: nextTurn,
      boardSize: boardSize
    }

    // Update token counts if this is a proper GameOfStrife state
    if ('currentPhase' in gosState && gosState.playerTokens) {
      const newPlayerTokens = { ...gosState.playerTokens }
      const tokensKey = playerIndex === 0 ? 'player0' : 'player1'
      newPlayerTokens[tokensKey]--
      updatedGoSState.playerTokens = newPlayerTokens

      // Update phase if all tokens placed
      const totalTokensRemaining = newPlayerTokens.player0 + newPlayerTokens.player1
      if (totalTokensRemaining === 0) {
        updatedGoSState.currentPhase = 'simulation'
      }
    }

    return {
      board: this.flattenBoard(newBoard), // Return flattened board for compatibility
      version: updatedGoSState.version,
      nextTurn,
      // Include full engine state for storage in match
      engineState: updatedGoSState
    }
  }

  checkResult(state: EngineState): ResultCheck {
    const gosState = state as unknown as GameOfStrifeEngineState

    // For basic EngineState, always return active (no complex simulation)
    if (!('currentPhase' in gosState)) {
      return { status: 'active' }
    }

    // If we're still in placement phase, game is active
    if (gosState.currentPhase === 'placement') {
      return { status: 'active' }
    }

    // If we've transitioned to simulation phase, run Conway's simulation
    if (gosState.currentPhase === 'simulation') {
      const simulatedState = this.runConwaySimulation(gosState)
      return this.determineWinner(simulatedState)
    }

    // If already finished, return existing result
    if (gosState.currentPhase === 'finished' || gosState.winner !== null) {
      return {
        status: 'finished',
        winner: gosState.winner || undefined,
        winningLine: gosState.winningLine || undefined
      }
    }

    return { status: 'active' }
  }

  // Conway's Game of Life simulation
  private runConwaySimulation(state: GameOfStrifeEngineState): GameOfStrifeEngineState {
    let currentBoard = state.board.map(row => row.map(cell => ({ ...cell })))
    let generation = 0
    const maxGenerations = this.settings.simulationGenerations || 100

    // Run simulation until stable or max generations reached
    while (generation < maxGenerations) {
      const nextBoard = this.simulateOneGeneration(currentBoard)

      // Check if board has stabilized (no changes)
      if (this.boardsEqual(currentBoard, nextBoard)) {
        break
      }

      currentBoard = nextBoard
      generation++
    }

    // Calculate final scores
    const finalScores = {
      player0: countLivingCells(currentBoard, 0),
      player1: countLivingCells(currentBoard, 1)
    }

    return {
      ...state,
      board: currentBoard,
      currentPhase: 'finished',
      generation,
      finalScores,
      finishedAt: new Date()
    }
  }

  private simulateOneGeneration(board: Cell[][]): Cell[][] {
    const size = board.length
    const newBoard = createBoard(size)

    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const cell = board[row][col]
        const neighbors = this.getNeighbors(board, row, col)
        const aliveNeighbors = neighbors.filter(n => n.alive).length

        // Apply Conway's rules with superpower modifications
        const shouldLive = this.shouldCellLive(cell, aliveNeighbors)
        const newOwner = this.determineNewOwner(cell, neighbors)

        newBoard[row][col] = {
          player: newOwner,
          alive: shouldLive,
          superpowerType: shouldLive ? cell.superpowerType : 0,
          memory: this.updateMemory(cell, shouldLive, aliveNeighbors)
        }
      }
    }

    return newBoard
  }

  private getNeighbors(board: Cell[][], row: number, col: number): Cell[] {
    const neighbors: Cell[] = []
    const size = board.length

    // Moore neighborhood (8 directions)
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue // Skip self

        const newRow = row + dr
        const newCol = col + dc

        if (isValidPosition(newRow, newCol, size)) {
          neighbors.push(board[newRow][newCol])
        }
      }
    }

    return neighbors
  }

  private shouldCellLive(cell: Cell, aliveNeighbors: number): boolean {
    const { birthRules, survivalRules } = this.settings.conwayRules

    if (cell.alive) {
      // Living cell: check survival rules
      return survivalRules.includes(aliveNeighbors)
    } else {
      // Dead cell: check birth rules
      return birthRules.includes(aliveNeighbors)
    }
  }

  private determineNewOwner(cell: Cell, neighbors: Cell[]): number | null {
    const aliveNeighbors = neighbors.filter(n => n.alive)

    if (aliveNeighbors.length === 0) {
      return null // No living neighbors
    }

    // If cell was alive and stays alive, keep owner
    if (cell.alive && this.shouldCellLive(cell, aliveNeighbors.length)) {
      return cell.player
    }

    // For new births, inherit from dominant neighbor
    const playerCounts: Record<number, number> = { 0: 0, 1: 0 }
    aliveNeighbors.forEach(neighbor => {
      if (neighbor.player !== null) {
        playerCounts[neighbor.player]++
      }
    })

    // Return player with most neighbors, or null if tied
    if (playerCounts[0] > playerCounts[1]) return 0
    if (playerCounts[1] > playerCounts[0]) return 1
    return null // Tie or no ownership
  }

  private updateMemory(cell: Cell, willLive: boolean, _aliveNeighbors: number): number {
    let memory = cell.memory

    if (cell.alive && !willLive) {
      // Cell is dying
      memory |= MemoryFlags.BATTLE_SCARRED
    }

    if (!cell.alive && willLive) {
      // Cell is being born
      memory |= MemoryFlags.HAS_CAUSED_BIRTH
    }

    if (cell.alive && willLive) {
      // Cell survived another generation
      memory |= MemoryFlags.IS_VETERAN
    }

    return memory
  }

  private boardsEqual(board1: Cell[][], board2: Cell[][]): boolean {
    if (board1.length !== board2.length) return false

    for (let row = 0; row < board1.length; row++) {
      if (board1[row].length !== board2[row].length) return false

      for (let col = 0; col < board1[row].length; col++) {
        const cell1 = board1[row][col]
        const cell2 = board2[row][col]

        if (cell1.alive !== cell2.alive || cell1.player !== cell2.player) {
          return false
        }
      }
    }

    return true
  }

  private determineWinner(state: GameOfStrifeEngineState): ResultCheck {
    if (!state.finalScores) {
      return { status: 'active' }
    }

    const { player0, player1 } = state.finalScores

    if (player0 > player1) {
      return { status: 'finished', winner: 'P1' }
    } else if (player1 > player0) {
      return { status: 'finished', winner: 'P2' }
    } else {
      return { status: 'finished', winner: 'draw' }
    }
  }

  // Utility method to flatten 2D board for compatibility with base engine
  private flattenBoard(board: Cell[][]): (string | null)[] {
    const flat: (string | null)[] = []

    for (let row = 0; row < board.length; row++) {
      for (let col = 0; col < board[row].length; col++) {
        const cell = board[row][col]
        if (cell.player !== null) {
          flat.push(cell.player === 0 ? 'P1' : 'P2')
        } else {
          flat.push(null)
        }
      }
    }

    return flat
  }

  // Getter for settings
  getSettings(): GameOfStrifeSettings {
    return { ...this.settings }
  }
}