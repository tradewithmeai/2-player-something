// Game of Strife specific types extending the base engine types
import { EngineState } from './types.js'

// Superpower types (0-7)
export type SuperpowerType = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

// Memory flags for cells (32-bit flags)
export enum MemoryFlags {
  HAS_SURVIVED_DEATH = 1 << 0,   // Cell survived when it should have died
  HAS_CAUSED_BIRTH = 1 << 1,     // Cell caused another cell to be born
  IS_VETERAN = 1 << 2,           // Cell survived multiple generations
  HAS_SPREAD = 1 << 3,           // Cell spread to new territory
  BATTLE_SCARRED = 1 << 4,       // Cell has been in combat
}

// Individual cell state
export interface Cell {
  player: number | null    // 0 (P1), 1 (P2), or null
  alive: boolean
  superpowerType: SuperpowerType  // 0-7 (normal + 7 superpower types)
  memory: number           // 32-bit flags for persistent effects
}

// Game phases
export type GamePhase = 'placement' | 'simulation' | 'paused' | 'finished' | 'waiting'

// Conway's rule configuration
export interface ConwayRules {
  birthRules: number[]     // Neighbor counts that cause birth
  survivalRules: number[]  // Neighbor counts that allow survival
}

// Placement data for token placement phase
export interface TokenPlacement {
  player: 0 | 1           // P1=0, P2=1 for consistency with Cell.player
  row: number
  col: number
  ord: number             // Placement order
  superpowerType?: SuperpowerType  // Optional superpower
}

// Game of Strife specific engine state extending base EngineState
export interface GameOfStrifeEngineState extends Omit<EngineState, 'board'> {
  // Override board to be 2D Cell array instead of 1D string array
  board: Cell[][]

  // Game phase management
  currentPhase: GamePhase
  generation: number       // Conway simulation generation counter

  // Board configuration
  boardSize: number        // Square grid dimensions

  // Rules configuration
  conwayRules: ConwayRules

  // Player token management
  playerTokens: {
    player0: number        // Remaining tokens for P1 (player 0)
    player1: number        // Remaining tokens for P2 (player 1)
  }

  // Placement history
  placements: TokenPlacement[]

  // Victory conditions (derived from simulation)
  finalScores?: {
    player0: number        // Living cells count for P1
    player1: number        // Living cells count for P2
  }
}

// Game settings for initialization
export interface GameOfStrifeSettings {
  boardSize: number
  tokensPerPlayer: number
  conwayRules: ConwayRules
  simulationGenerations?: number  // Optional limit for simulation
}

// Default game settings
export const DEFAULT_GAME_SETTINGS: GameOfStrifeSettings = {
  boardSize: 20,
  tokensPerPlayer: 10,
  conwayRules: {
    birthRules: [3],        // Standard Conway's rule: birth on 3 neighbors
    survivalRules: [2, 3]   // Standard Conway's rule: survive on 2 or 3 neighbors
  },
  simulationGenerations: 100  // Reasonable limit to prevent infinite games
}

// Superpower definitions for reference
export const SUPERPOWER_NAMES = [
  'Normal',      // 0
  'Tank',        // 1 - Enhanced durability
  'Spreader',    // 2 - Increased propagation
  'Survivor',    // 3 - Resistance to death
  'Ghost',       // 4 - Special phase abilities
  'Replicator',  // 5 - Enhanced reproduction
  'Destroyer',   // 6 - Offensive capabilities
  'Hybrid'       // 7 - Combined abilities
] as const

// Utility functions for working with Game of Strife data
export const createEmptyCell = (): Cell => ({
  player: null,
  alive: false,
  superpowerType: 0,
  memory: 0
})

export const createBoard = (size: number): Cell[][] => {
  return Array(size).fill(null).map(() =>
    Array(size).fill(null).map(() => createEmptyCell())
  )
}

export const isValidPosition = (row: number, col: number, boardSize: number): boolean => {
  return row >= 0 && row < boardSize && col >= 0 && col < boardSize
}

export const countLivingCells = (board: Cell[][], player: number | null = null): number => {
  let count = 0
  for (let row = 0; row < board.length; row++) {
    for (let col = 0; col < board[row].length; col++) {
      const cell = board[row][col]
      if (cell.alive && (player === null || cell.player === player)) {
        count++
      }
    }
  }
  return count
}

// Convert 2D position to 1D index for compatibility with base engine
export const positionToIndex = (row: number, col: number, boardSize: number): number => {
  return row * boardSize + col
}

// Convert 1D index to 2D position for compatibility with base engine
export const indexToPosition = (index: number, boardSize: number): { row: number, col: number } => {
  return {
    row: Math.floor(index / boardSize),
    col: index % boardSize
  }
}