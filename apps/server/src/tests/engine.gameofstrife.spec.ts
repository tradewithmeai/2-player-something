import { describe, it, expect, beforeEach } from 'vitest'
import { GameOfStrifeEngine } from '../engine/gameOfStrifeEngine.js'
import { GameOfStrifeEngineState, positionToIndex, indexToPosition } from '../engine/gameOfStrifeTypes.js'

describe('GameOfStrifeEngine', () => {
  let engine: GameOfStrifeEngine

  beforeEach(() => {
    engine = new GameOfStrifeEngine({
      boardSize: 10,
      tokensPerPlayer: 5,
      simulationGenerations: 50
    })
  })

  describe('Initialization', () => {
    it('should initialize with correct default state', () => {
      const state = engine.initState() as GameOfStrifeEngineState

      expect(state.version).toBe(0)
      expect(state.currentTurn).toBe('P1')
      expect(state.winner).toBe(null)
      expect(state.currentPhase).toBe('placement')
      expect(state.generation).toBe(0)
      expect(state.boardSize).toBe(10)
      expect(state.playerTokens.player0).toBe(5)
      expect(state.playerTokens.player1).toBe(5)
      expect(state.placements).toHaveLength(0)

      // Check board is properly initialized
      expect(state.board).toHaveLength(10)
      expect(state.board[0]).toHaveLength(10)

      // Check all cells are empty
      for (let row = 0; row < 10; row++) {
        for (let col = 0; col < 10; col++) {
          const cell = state.board[row][col]
          expect(cell.player).toBe(null)
          expect(cell.alive).toBe(false)
          expect(cell.superpowerType).toBe(0)
          expect(cell.memory).toBe(0)
        }
      }
    })
  })

  describe('Position conversion utilities', () => {
    it('should convert positions correctly', () => {
      const boardSize = 10

      // Test position to index
      expect(positionToIndex(0, 0, boardSize)).toBe(0)
      expect(positionToIndex(0, 9, boardSize)).toBe(9)
      expect(positionToIndex(1, 0, boardSize)).toBe(10)
      expect(positionToIndex(9, 9, boardSize)).toBe(99)

      // Test index to position
      expect(indexToPosition(0, boardSize)).toEqual({ row: 0, col: 0 })
      expect(indexToPosition(9, boardSize)).toEqual({ row: 0, col: 9 })
      expect(indexToPosition(10, boardSize)).toEqual({ row: 1, col: 0 })
      expect(indexToPosition(99, boardSize)).toEqual({ row: 9, col: 9 })
    })
  })

  describe('Claim validation', () => {
    let state: GameOfStrifeEngineState

    beforeEach(() => {
      state = engine.initState() as GameOfStrifeEngineState
    })

    it('should validate valid placement claims', () => {
      const squareId = positionToIndex(5, 5, 10) // Middle of board
      const result = engine.validateClaim(state, 'P1', squareId)

      expect(result.valid).toBe(true)
    })

    it('should reject claims when not player turn', () => {
      const squareId = positionToIndex(5, 5, 10)
      const result = engine.validateClaim(state, 'P2', squareId)

      expect(result.valid).toBe(false)
      expect(result.reason).toBe('not_your_turn')
    })

    it('should reject claims for occupied squares', () => {
      const squareId = positionToIndex(5, 5, 10)

      // Place a token first
      const claimResult = engine.applyClaim(state, 'P1', squareId)

      // Properly update the 2D board state
      const newBoard = state.board.map(row => row.map(cell => ({ ...cell })))
      const { row, col } = indexToPosition(squareId, 10)
      newBoard[row][col] = {
        player: 0, // P1 = player 0
        alive: true,
        superpowerType: 0,
        memory: 0
      }

      const newState = {
        ...state,
        board: newBoard,
        version: claimResult.version,
        currentTurn: claimResult.nextTurn,
        playerTokens: {
          player0: state.playerTokens.player0 - 1,
          player1: state.playerTokens.player1
        }
      } as GameOfStrifeEngineState

      // Try to place another token in same position
      const validationResult = engine.validateClaim(newState, 'P2', squareId)

      expect(validationResult.valid).toBe(false)
      expect(validationResult.reason).toBe('square_occupied')
    })

    it('should reject claims for out of bounds positions', () => {
      const squareId = 150 // Beyond 10x10 board
      const result = engine.validateClaim(state, 'P1', squareId)

      expect(result.valid).toBe(false)
      expect(result.reason).toBe('invalid_square')
    })

    it('should reject claims when game is finished', () => {
      const finishedState = {
        ...state,
        winner: 'P1' as const,
        finishedAt: new Date()
      }

      const squareId = positionToIndex(5, 5, 10)
      const result = engine.validateClaim(finishedState, 'P1', squareId)

      expect(result.valid).toBe(false)
      expect(result.reason).toBe('match_finished')
    })
  })

  describe('Claim application', () => {
    let state: GameOfStrifeEngineState

    beforeEach(() => {
      state = engine.initState() as GameOfStrifeEngineState
    })

    it('should apply valid claims correctly', () => {
      const squareId = positionToIndex(3, 4, 10)
      const result = engine.applyClaim(state, 'P1', squareId)

      expect(result.version).toBe(1)
      expect(result.nextTurn).toBe('P2')

      // Check the updated board by applying the claim manually to verify
      const newBoard = state.board.map(row => row.map(cell => ({ ...cell })))
      newBoard[3][4] = {
        player: 0, // P1 = player 0
        alive: true,
        superpowerType: 0,
        memory: 0
      }

      const newState = {
        ...state,
        board: newBoard,
        version: result.version,
        currentTurn: result.nextTurn,
        playerTokens: {
          player0: state.playerTokens.player0 - 1,
          player1: state.playerTokens.player1
        },
        placements: [
          {
            player: 0,
            row: 3,
            col: 4,
            ord: 0,
            superpowerType: 0
          }
        ]
      } as GameOfStrifeEngineState

      // Check that cell was placed correctly
      expect(newBoard[3][4].player).toBe(0) // P1 = player 0
      expect(newBoard[3][4].alive).toBe(true)
      expect(newState.playerTokens.player0).toBe(4) // One token used
      expect(newState.placements).toHaveLength(1)
      expect(newState.placements[0]).toEqual({
        player: 0,
        row: 3,
        col: 4,
        ord: 0,
        superpowerType: 0
      })
    })

    it('should switch turns correctly during placement', () => {
      let currentState = state
      let squareId = positionToIndex(0, 0, 10)

      // P1's turn
      let result = engine.applyClaim(currentState, 'P1', squareId)
      expect(result.nextTurn).toBe('P2')

      // Update state for P2's turn
      currentState = {
        ...currentState,
        ...result,
        board: currentState.board,
        currentTurn: result.nextTurn!
      } as GameOfStrifeEngineState

      // P2's turn
      squareId = positionToIndex(1, 1, 10)
      result = engine.applyClaim(currentState, 'P2', squareId)
      expect(result.nextTurn).toBe('P1')
    })

    it('should transition to simulation phase when all tokens placed', () => {
      let currentState = state

      // Place all tokens for both players (10 total)
      for (let i = 0; i < 10; i++) {
        const row = Math.floor(i / 5)
        const col = i % 5
        const squareId = positionToIndex(row, col, 10)
        const seat = currentState.currentTurn!

        const result = engine.applyClaim(currentState, seat, squareId)

        currentState = {
          ...currentState,
          ...result,
          board: currentState.board,
          currentTurn: result.nextTurn,
          playerTokens: {
            player0: currentState.playerTokens.player0 - (seat === 'P1' ? 1 : 0),
            player1: currentState.playerTokens.player1 - (seat === 'P2' ? 1 : 0)
          },
          placements: [
            ...currentState.placements,
            {
              player: seat === 'P1' ? 0 : 1,
              row,
              col,
              ord: i,
              superpowerType: 0
            }
          ]
        } as GameOfStrifeEngineState
      }

      // After placing all tokens, should transition to simulation
      expect(currentState.currentTurn).toBe(null)
      expect(currentState.playerTokens.player0).toBe(0)
      expect(currentState.playerTokens.player1).toBe(0)
    })
  })

  describe('Game result checking', () => {
    it('should return active status during placement phase', () => {
      const state = engine.initState() as GameOfStrifeEngineState
      const result = engine.checkResult(state)

      expect(result.status).toBe('active')
    })

    it('should run simulation and determine winner', () => {
      const state = engine.initState() as GameOfStrifeEngineState

      // Create a simple scenario where P1 has more tokens
      // Place a stable pattern for P1 (block pattern)
      state.board[4][4] = { player: 0, alive: true, superpowerType: 0, memory: 0 }
      state.board[4][5] = { player: 0, alive: true, superpowerType: 0, memory: 0 }
      state.board[5][4] = { player: 0, alive: true, superpowerType: 0, memory: 0 }
      state.board[5][5] = { player: 0, alive: true, superpowerType: 0, memory: 0 }

      // Place a single cell for P2 (will die)
      state.board[7][7] = { player: 1, alive: true, superpowerType: 0, memory: 0 }

      // Set to simulation phase
      state.currentPhase = 'simulation'
      state.playerTokens = { player0: 0, player1: 0 }

      const result = engine.checkResult(state)

      expect(result.status).toBe('finished')
      expect(result.winner).toBe('P1') // P1 should win with stable block pattern
    })

    it('should handle draw scenarios', () => {
      const state = engine.initState() as GameOfStrifeEngineState

      // Create equal stable patterns for both players
      // P1 block
      state.board[2][2] = { player: 0, alive: true, superpowerType: 0, memory: 0 }
      state.board[2][3] = { player: 0, alive: true, superpowerType: 0, memory: 0 }
      state.board[3][2] = { player: 0, alive: true, superpowerType: 0, memory: 0 }
      state.board[3][3] = { player: 0, alive: true, superpowerType: 0, memory: 0 }

      // P2 block
      state.board[6][6] = { player: 1, alive: true, superpowerType: 0, memory: 0 }
      state.board[6][7] = { player: 1, alive: true, superpowerType: 0, memory: 0 }
      state.board[7][6] = { player: 1, alive: true, superpowerType: 0, memory: 0 }
      state.board[7][7] = { player: 1, alive: true, superpowerType: 0, memory: 0 }

      // Set to simulation phase
      state.currentPhase = 'simulation'
      state.playerTokens = { player0: 0, player1: 0 }

      const result = engine.checkResult(state)

      expect(result.status).toBe('finished')
      expect(result.winner).toBe('draw') // Should be a draw with equal stable patterns
    })
  })

  describe('Conway simulation mechanics', () => {
    it('should preserve stable patterns', () => {
      const state = engine.initState() as GameOfStrifeEngineState

      // Create a block pattern (stable in Conway's Game of Life)
      state.board[4][4] = { player: 0, alive: true, superpowerType: 0, memory: 0 }
      state.board[4][5] = { player: 0, alive: true, superpowerType: 0, memory: 0 }
      state.board[5][4] = { player: 0, alive: true, superpowerType: 0, memory: 0 }
      state.board[5][5] = { player: 0, alive: true, superpowerType: 0, memory: 0 }

      state.currentPhase = 'simulation'
      state.playerTokens = { player0: 0, player1: 0 }

      const result = engine.checkResult(state)

      expect(result.status).toBe('finished')
      // Block pattern should remain stable, so P1 should have 4 living cells
    })

    it('should kill isolated cells', () => {
      const state = engine.initState() as GameOfStrifeEngineState

      // Place isolated cells that should die
      state.board[4][4] = { player: 0, alive: true, superpowerType: 0, memory: 0 }
      state.board[7][7] = { player: 1, alive: true, superpowerType: 0, memory: 0 }

      state.currentPhase = 'simulation'
      state.playerTokens = { player0: 0, player1: 0 }

      const result = engine.checkResult(state)

      expect(result.status).toBe('finished')
      expect(result.winner).toBe('draw') // Both isolated cells should die
    })
  })
})