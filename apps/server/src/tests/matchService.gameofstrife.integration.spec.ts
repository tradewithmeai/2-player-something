import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MatchService } from '../services/matchService.js'
import { GameOfStrifeEngineState } from '../engine/gameOfStrifeTypes.js'

describe('MatchService with GameOfStrifeEngine Integration', () => {
  let matchService: MatchService
  let originalEngineKind: string | undefined

  beforeEach(() => {
    // Set GameOfStrife engine for this test
    originalEngineKind = process.env.ENGINE_KIND
    process.env.ENGINE_KIND = 'gameofstrife'
    matchService = new MatchService()
  })

  afterEach(() => {
    // Restore original engine kind
    if (originalEngineKind !== undefined) {
      process.env.ENGINE_KIND = originalEngineKind
    } else {
      delete process.env.ENGINE_KIND
    }
  })

  describe('GameOfStrife Engine Integration', () => {
    it('should create match with GameOfStrife engine and correct initial state', () => {
      const players = ['player1', 'player2']
      const match = matchService.createMatch('room123', players)

      expect(match.id).toBeTruthy()
      expect(match.roomId).toBe('room123')
      expect(match.players).toEqual(players)
      expect(match.status).toBe('active')
      expect(match.currentTurn).toBe('P1')
      expect(match.winner).toBe(null)
      expect(match.version).toBe(0)

      // The board should be much larger than tic-tac-toe (400 squares for 20x20)
      expect(match.board).toHaveLength(400) // 20x20 = 400 squares

      // All squares should be initially empty
      expect(match.board.every(square => square === null)).toBe(true)
    })

    it('should handle token placement during placement phase', async () => {
      const players = ['player1', 'player2']
      const match = matchService.createMatch('room123', players)

      // Place a token for P1 at position (5,5) = index 105 in 20x20 board
      const squareId = 5 * 20 + 5 // row 5, col 5 in 20x20 board
      const claimResult = await matchService.claimSquare({
        matchId: match.id,
        squareId,
        selectionId: 'test-selection-1',
        playerId: 'player1'
      })

      expect(claimResult.success).toBe(true)
      expect(claimResult.nextTurn).toBe('P2')
      expect(claimResult.matchState?.version).toBe(1)

      // The specific square should now be claimed
      const updatedMatch = matchService.getMatch(match.id)
      expect(updatedMatch?.board[squareId]).toBe('P1')
      expect(updatedMatch?.currentTurn).toBe('P2')
    })

    it('should reject claims for occupied squares', async () => {
      const players = ['player1', 'player2']
      const match = matchService.createMatch('room123', players)

      const squareId = 100 // Some position

      // First claim by P1
      await matchService.claimSquare({
        matchId: match.id,
        squareId,
        selectionId: 'test-selection-1',
        playerId: 'player1'
      })

      // Second claim by P2 on same square
      const claimResult = await matchService.claimSquare({
        matchId: match.id,
        squareId,
        selectionId: 'test-selection-2',
        playerId: 'player2'
      })

      expect(claimResult.success).toBe(false)
      expect(claimResult.reason).toBe('square_occupied')
    })

    it('should reject claims when not player turn', async () => {
      const players = ['player1', 'player2']
      const match = matchService.createMatch('room123', players)

      const squareId = 50

      // Try to claim with P2 when it's P1's turn
      const claimResult = await matchService.claimSquare({
        matchId: match.id,
        squareId,
        selectionId: 'test-selection-1',
        playerId: 'player2' // Wrong player
      })

      expect(claimResult.success).toBe(false)
      expect(claimResult.reason).toBe('not_your_turn')
    })

    it('should switch turns correctly during placement', async () => {
      const players = ['player1', 'player2']
      const match = matchService.createMatch('room123', players)

      // P1's turn
      expect(match.currentTurn).toBe('P1')

      const result1 = await matchService.claimSquare({
        matchId: match.id,
        squareId: 50,
        selectionId: 'test-1',
        playerId: 'player1'
      })

      expect(result1.success).toBe(true)
      expect(result1.nextTurn).toBe('P2')

      // P2's turn
      const result2 = await matchService.claimSquare({
        matchId: match.id,
        squareId: 51,
        selectionId: 'test-2',
        playerId: 'player2'
      })

      expect(result2.success).toBe(true)
      expect(result2.nextTurn).toBe('P1') // Back to P1
    })

    it('should transition to simulation after all tokens placed', async () => {
      // Create a small game for faster testing
      process.env.ENGINE_KIND = 'gameofstrife'
      matchService = new MatchService()

      const players = ['player1', 'player2']
      const match = matchService.createMatch('room123', players)

      // With default settings (10 tokens per player), we need to place 20 tokens total
      let currentPlayer = 'player1'
      let currentTurn: 'P1' | 'P2' | null = 'P1'

      // Place tokens alternately until all are used
      for (let i = 0; i < 20; i++) {
        const squareId = i // Use different positions

        const result = await matchService.claimSquare({
          matchId: match.id,
          squareId,
          selectionId: `token-${i}`,
          playerId: currentPlayer
        })

        expect(result.success).toBe(true)

        if (i < 19) { // Not the last move
          expect(result.nextTurn).toBeTruthy()
          currentTurn = result.nextTurn!
          currentPlayer = currentTurn === 'P1' ? 'player1' : 'player2'
        } else { // Last move should transition to simulation
          expect(result.nextTurn).toBe(null) // No more turns during simulation
        }
      }

      // After all tokens placed, the game should determine a winner
      const finalMatch = matchService.getMatch(match.id)
      expect(finalMatch?.status).toBe('finished')
      expect(finalMatch?.winner).toBeTruthy() // Should have a winner or draw
    }, 10000) // Longer timeout for simulation

    it('should reject claims when game is finished', async () => {
      const players = ['player1', 'player2']
      const match = matchService.createMatch('room123', players)

      // Manually finish the game by setting winner
      const matchState = matchService.getMatch(match.id)!
      matchState.status = 'finished'
      matchState.winner = 'P1'
      matchState.finishedAt = new Date()

      const claimResult = await matchService.claimSquare({
        matchId: match.id,
        squareId: 50,
        selectionId: 'test-selection-1',
        playerId: 'player1'
      })

      expect(claimResult.success).toBe(false)
      expect(claimResult.reason).toBe('match_finished')
    })

    it('should handle out of bounds positions', async () => {
      const players = ['player1', 'player2']
      const match = matchService.createMatch('room123', players)

      // Try to claim position beyond 20x20 board
      const claimResult = await matchService.claimSquare({
        matchId: match.id,
        squareId: 500, // Beyond 20x20 = 400 squares
        selectionId: 'test-selection-1',
        playerId: 'player1'
      })

      expect(claimResult.success).toBe(false)
      expect(claimResult.reason).toBe('invalid_square')
    })
  })
})