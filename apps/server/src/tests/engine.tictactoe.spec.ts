import { describe, it, expect, beforeEach } from 'vitest'
import { TicTacToeEngine } from '../engine/tictactoeEngine.js'

describe('TicTacToe Engine', () => {
  let engine: TicTacToeEngine

  beforeEach(() => {
    engine = new TicTacToeEngine()
  })

  it('should initialize a fresh game state', () => {
    const state = engine.initState()
    
    expect(state.board).toEqual(Array(9).fill(null))
    expect(state.currentTurn).toBe('P1')
    expect(state.winner).toBe(null)
    expect(state.winningLine).toBe(null)
    expect(state.version).toBe(0)
    expect(state.finishedAt).toBeUndefined()
  })

  it('should simulate a simple win sequence and detect the correct winning line', () => {
    let state = engine.initState()
    
    // Simulate P1 wins with top row: [0, 1, 2]
    // P1 plays 0
    let validation = engine.validateClaim(state, 'P1', 0)
    expect(validation.valid).toBe(true)
    
    let application = engine.applyClaim(state, 'P1', 0)
    state = {
      ...state,
      board: application.board,
      version: application.version,
      currentTurn: application.nextTurn
    }
    expect(state.board[0]).toBe('P1')
    expect(state.currentTurn).toBe('P2')
    
    // P2 plays 3
    validation = engine.validateClaim(state, 'P2', 3)
    expect(validation.valid).toBe(true)
    
    application = engine.applyClaim(state, 'P2', 3)
    state = {
      ...state,
      board: application.board,
      version: application.version,
      currentTurn: application.nextTurn
    }
    expect(state.board[3]).toBe('P2')
    expect(state.currentTurn).toBe('P1')
    
    // P1 plays 1
    validation = engine.validateClaim(state, 'P1', 1)
    expect(validation.valid).toBe(true)
    
    application = engine.applyClaim(state, 'P1', 1)
    state = {
      ...state,
      board: application.board,
      version: application.version,
      currentTurn: application.nextTurn
    }
    expect(state.board[1]).toBe('P1')
    
    // P2 plays 4
    validation = engine.validateClaim(state, 'P2', 4)
    expect(validation.valid).toBe(true)
    
    application = engine.applyClaim(state, 'P2', 4)
    state = {
      ...state,
      board: application.board,
      version: application.version,
      currentTurn: application.nextTurn
    }
    
    // P1 plays 2 for the win
    validation = engine.validateClaim(state, 'P1', 2)
    expect(validation.valid).toBe(true)
    
    application = engine.applyClaim(state, 'P1', 2)
    state = {
      ...state,
      board: application.board,
      version: application.version,
      currentTurn: application.nextTurn
    }
    expect(state.board[2]).toBe('P1')
    
    // Check for win
    const result = engine.checkResult(state)
    expect(result.status).toBe('finished')
    expect(result.winner).toBe('P1')
    expect(result.winningLine).toEqual([0, 1, 2]) // Top row
  })

  it('should detect a draw when all squares are filled with no winner', () => {
    // Create a draw board state manually
    const drawState = {
      board: ['P1', 'P2', 'P1', 'P2', 'P2', 'P1', 'P2', 'P1', 'P2'],
      currentTurn: 'P1' as const,
      winner: null,
      winningLine: null,
      version: 9,
      finishedAt: undefined
    }
    
    const result = engine.checkResult(drawState)
    expect(result.status).toBe('finished')
    expect(result.winner).toBe('draw')
    expect(result.winningLine).toBeUndefined()
  })

  it('should validate claims correctly', () => {
    const state = engine.initState()
    
    // Valid claim
    let validation = engine.validateClaim(state, 'P1', 0)
    expect(validation.valid).toBe(true)
    
    // Invalid square ID
    validation = engine.validateClaim(state, 'P1', -1)
    expect(validation.valid).toBe(false)
    expect(validation.reason).toBe('invalid_square')
    
    validation = engine.validateClaim(state, 'P1', 9)
    expect(validation.valid).toBe(false)
    expect(validation.reason).toBe('invalid_square')
    
    // Wrong turn
    validation = engine.validateClaim(state, 'P2', 0)
    expect(validation.valid).toBe(false)
    expect(validation.reason).toBe('not_your_turn')
    
    // Occupied square
    const occupiedState = {
      ...state,
      board: ['P1', null, null, null, null, null, null, null, null]
    }
    validation = engine.validateClaim(occupiedState, 'P1', 0)
    expect(validation.valid).toBe(false)
    expect(validation.reason).toBe('square_occupied')
  })
})