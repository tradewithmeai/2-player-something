// Game of Strife types adapted for 2-player system

export interface Cell {
  player: number | null; // 0 for player 1, 1 for player 2, null for empty
  alive: boolean;
  superpowerType: number; // 0 = normal, 1-7 = different superpower types
  memory: number; // 32-bit flags for persistent memory
}

export type GameStage = 'placement' | 'simulation' | 'paused' | 'finished' | 'waiting';

// Memory bit flags
export const MEMORY_FLAGS = {
  HAS_SURVIVED_DEATH: 1 << 0,
  HAS_CAUSED_BIRTH: 1 << 1,
  IS_VETERAN: 1 << 2,
  HAS_SPREAD: 1 << 3,
  BATTLE_SCARRED: 1 << 4,
};

// Game of Strife specific state that extends the base game state
export interface GameOfStrifeState {
  // Core game data
  board: Cell[][]
  boardSize: number
  stage: GameStage
  generation: number

  // Player data
  currentPlayer: 0 | 1 | null
  playerTokens: {
    player0: number
    player1: number
  }

  // Game flow
  winner: 0 | 1 | null
  isFinished: boolean

  // Conway simulation
  simulationSpeed: number
  simulationRunning: boolean

  // Metadata
  version: number
  startedAt?: Date
  finishedAt?: Date
}

// Conway's Game of Life rules
export interface ConwayRules {
  birthRules: number[]     // Neighbor counts that cause birth
  survivalRules: number[]  // Neighbor counts that allow survival
}

export const DEFAULT_CONWAY_RULES: ConwayRules = {
  birthRules: [3],        // Standard Conway's rule: birth on 3 neighbors
  survivalRules: [2, 3]   // Standard Conway's rule: survive on 2 or 3 neighbors
}

// Game configuration
export interface GameOfStrifeConfig {
  boardSize: number
  tokensPerPlayer: number
  conwayRules: ConwayRules
  simulationGenerations?: number
  simulationSpeed?: number // milliseconds between generations
}

export const DEFAULT_GAME_CONFIG: GameOfStrifeConfig = {
  boardSize: 20,
  tokensPerPlayer: 10,
  conwayRules: DEFAULT_CONWAY_RULES,
  simulationGenerations: 100,
  simulationSpeed: 200
}

// Action types for the game
export type GameOfStrifeAction =
  | { type: 'PLACE_TOKEN'; payload: { row: number; col: number; player: 0 | 1 } }
  | { type: 'START_SIMULATION' }
  | { type: 'PAUSE_SIMULATION' }
  | { type: 'RESUME_SIMULATION' }
  | { type: 'STEP_SIMULATION' }
  | { type: 'FINISH_GAME'; payload: { winner: 0 | 1 | null } }
  | { type: 'RESET_GAME' }
  | { type: 'UPDATE_BOARD'; payload: { board: Cell[][] } }

// Utility functions
export function createEmptyCell(): Cell {
  return {
    player: null,
    alive: false,
    superpowerType: 0,
    memory: 0
  }
}

export function createEmptyBoard(size: number): Cell[][] {
  return Array(size).fill(null).map(() =>
    Array(size).fill(null).map(() => createEmptyCell())
  )
}

export function isCellEmpty(cell: Cell): boolean {
  return cell.player === null
}

export function isCellOccupied(cell: Cell): boolean {
  return cell.player !== null
}

export function countLivingCells(board: Cell[][], player?: number): number {
  let count = 0
  for (let row = 0; row < board.length; row++) {
    for (let col = 0; col < board[row].length; col++) {
      const cell = board[row][col]
      if (cell.alive && (player === undefined || cell.player === player)) {
        count++
      }
    }
  }
  return count
}

export function getBoardFromFlat(flatBoard: (string | null)[], boardSize: number): Cell[][] {
  const board = createEmptyBoard(boardSize)

  for (let i = 0; i < flatBoard.length; i++) {
    const row = Math.floor(i / boardSize)
    const col = i % boardSize

    if (row < boardSize && col < boardSize && flatBoard[i] !== null) {
      board[row][col] = {
        player: flatBoard[i] === 'P1' ? 0 : 1,
        alive: true,
        superpowerType: 0,
        memory: 0
      }
    }
  }

  return board
}

export function flattenBoard(board: Cell[][]): (string | null)[] {
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

// Position utilities
export function positionToIndex(row: number, col: number, boardSize: number): number {
  return row * boardSize + col
}

export function indexToPosition(index: number, boardSize: number): { row: number, col: number } {
  return {
    row: Math.floor(index / boardSize),
    col: index % boardSize
  }
}