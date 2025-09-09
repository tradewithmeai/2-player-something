import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MatchService } from '../services/matchService.js'

describe('Simul Mode Tests', () => {
  let matchService: MatchService
  const originalEnv = process.env

  beforeEach(() => {
    // Set simul mode environment
    process.env.MATCH_MODE = 'simul'
    process.env.SIMUL_WINDOW_MS = '100' // Short window for tests
    process.env.SIMUL_STARTER_ALTERNATION = 'true'
    
    matchService = new MatchService()
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('Match Creation in Simul Mode', () => {
    it('should create match with simul mode', () => {
      const players = ['player1', 'player2']
      const match = matchService.createMatch('room1', players)

      expect(match.mode).toBe('simul')
      expect(match.currentWindowId).toBe(0)
      expect(match.currentWindowStarter).toBe('P1')
    })
  })

  describe('Window Lifecycle', () => {
    it('should open and close simul windows', async () => {
      const players = ['player1', 'player2']
      const match = matchService.createMatch('room1', players)

      // Open first window
      const windowData = matchService.openSimulWindow(match.id)
      expect(windowData).toBeTruthy()
      expect(windowData?.windowId).toBe(1)
      expect(windowData?.starterSeat).toBe('P1')

      // Wait for window to close automatically
      await new Promise(resolve => setTimeout(resolve, 150))

      // Check window closed
      const closedMatch = matchService.getMatch(match.id)
      expect(closedMatch?.currentWindowId).toBe(1)
    })
  })

  describe('Claim Buffering', () => {
    it('should buffer claims in simul mode', async () => {
      const players = ['player1', 'player2']
      const match = matchService.createMatch('room1', players)

      // Open window
      matchService.openSimulWindow(match.id)

      // Both players claim squares
      const result1 = await matchService.claimSquare({
        matchId: match.id,
        playerId: 'player1',
        squareId: 0,
        selectionId: 'sel1'
      })

      const result2 = await matchService.claimSquare({
        matchId: match.id,
        playerId: 'player2',
        squareId: 1,
        selectionId: 'sel2'
      })

      // Both should succeed (buffered)
      expect(result1.success).toBe(true)
      expect(result2.success).toBe(true)

      // Board should still be empty until window closes
      const updatedMatch = matchService.getMatch(match.id)
      expect(updatedMatch?.board.every(square => square === null)).toBe(true)
    })

    it('should handle same square conflicts', async () => {
      const players = ['player1', 'player2']
      const match = matchService.createMatch('room1', players)

      // Open window
      matchService.openSimulWindow(match.id)

      // Both players claim same square
      const result1 = await matchService.claimSquare({
        matchId: match.id,
        playerId: 'player1',
        squareId: 0,
        selectionId: 'sel1'
      })

      await new Promise(resolve => setTimeout(resolve, 10)) // Small delay for timestamp difference

      const result2 = await matchService.claimSquare({
        matchId: match.id,
        playerId: 'player2',
        squareId: 0,
        selectionId: 'sel2'
      })

      // Both should succeed (buffered)
      expect(result1.success).toBe(true)
      expect(result2.success).toBe(true)

      // Close window manually to resolve conflicts
      const windowResult = matchService.closeSimulWindow(match.id)
      expect(windowResult).toBeTruthy()
      
      // Only one should be applied, one rejected
      expect(windowResult?.applied.length).toBe(1)
      expect(windowResult?.rejected.length).toBe(1)
      expect(windowResult?.rejected[0].reason).toBe('conflict_lost')
    })
  })

  describe('Different Squares Application', () => {
    it('should apply both claims when different squares are selected', async () => {
      const players = ['player1', 'player2']
      const match = matchService.createMatch('room1', players)

      // Open window
      matchService.openSimulWindow(match.id)

      // Players claim different squares
      await matchService.claimSquare({
        matchId: match.id,
        playerId: 'player1',
        squareId: 0,
        selectionId: 'sel1'
      })

      await matchService.claimSquare({
        matchId: match.id,
        playerId: 'player2',
        squareId: 1,
        selectionId: 'sel2'
      })

      // Close window
      const windowResult = matchService.closeSimulWindow(match.id)
      
      // Both should be applied
      expect(windowResult?.applied.length).toBe(2)
      expect(windowResult?.rejected.length).toBe(0)

      // Check final board state
      const finalMatch = matchService.getMatch(match.id)
      expect(finalMatch?.board[0]).toBe('P1')
      expect(finalMatch?.board[1]).toBe('P2')
      expect(finalMatch?.version).toBe(2) // Version should increment for each application
    })
  })

  describe('Rate Limiting in Simul Mode', () => {
    it('should enforce rate limits per player', async () => {
      const players = ['player1', 'player2']
      const match = matchService.createMatch('room1', players)

      matchService.openSimulWindow(match.id)

      // Spam claims from one player
      const results = []
      for (let i = 0; i < 15; i++) {
        const result = await matchService.claimSquare({
          matchId: match.id,
          playerId: 'player1',
          squareId: i % 9,
          selectionId: `sel${i}`
        })
        results.push(result)
      }

      // Should hit rate limit
      const failedResults = results.filter(r => !r.success)
      expect(failedResults.length).toBeGreaterThan(0)
    })
  })

  describe('Win Condition in Simul Mode', () => {
    it('should detect wins after window closes', async () => {
      const players = ['player1', 'player2']
      const match = matchService.createMatch('room1', players)

      // Simulate a winning scenario across multiple windows
      // Window 1: P1 claims [0, 1], P2 claims [3, 4]
      matchService.openSimulWindow(match.id)
      
      await matchService.claimSquare({
        matchId: match.id,
        playerId: 'player1',
        squareId: 0,
        selectionId: 'p1_1'
      })
      
      await matchService.claimSquare({
        matchId: match.id,
        playerId: 'player1',
        squareId: 1,
        selectionId: 'p1_2'
      })
      
      await matchService.claimSquare({
        matchId: match.id,
        playerId: 'player2',
        squareId: 3,
        selectionId: 'p2_1'
      })
      
      await matchService.claimSquare({
        matchId: match.id,
        playerId: 'player2',
        squareId: 4,
        selectionId: 'p2_2'
      })

      matchService.closeSimulWindow(match.id)

      // Window 2: P1 completes winning line with square 2
      matchService.openSimulWindow(match.id)
      
      await matchService.claimSquare({
        matchId: match.id,
        playerId: 'player1',
        squareId: 2,
        selectionId: 'p1_win'
      })

      matchService.closeSimulWindow(match.id)

      // Check for win
      const finalMatch = matchService.getMatch(match.id)
      expect(finalMatch?.status).toBe('finished')
      expect(finalMatch?.winner).toBe('P1')
      expect(finalMatch?.winningLine).toEqual([0, 1, 2])
    })
  })
})