import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { MatchService } from '../services/matchService.js'

// Mock console.log to capture structured logs
let logSpy: ReturnType<typeof vi.spyOn>
let capturedLogs: any[]

describe('GAME-RESULT-PATCH Tests', () => {
  let matchService: MatchService

  beforeEach(() => {
    matchService = new MatchService()
    
    // Setup console log spy
    capturedLogs = []
    logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      const logStr = args.find(arg => typeof arg === 'string' && arg.startsWith('{'))
      if (logStr) {
        try {
          capturedLogs.push(JSON.parse(logStr))
        } catch {
          capturedLogs.push(logStr)
        }
      }
    })
  })

  afterEach(() => {
    logSpy.mockRestore()
  })

  test('Server unit: Winner detection logs result.decided once', async () => {
    // Create match
    const match = matchService.createMatch('room1', ['player1', 'player2'])
    
    // Clear initial logs
    capturedLogs = []
    
    // Play winning sequence for P1: positions 0, 1, 2 (top row)
    await matchService.claimSquare({ matchId: match.id, squareId: 0, selectionId: 'sel1', playerId: 'player1' })
    await matchService.claimSquare({ matchId: match.id, squareId: 3, selectionId: 'sel2', playerId: 'player2' })
    await matchService.claimSquare({ matchId: match.id, squareId: 1, selectionId: 'sel3', playerId: 'player1' })
    await matchService.claimSquare({ matchId: match.id, squareId: 4, selectionId: 'sel4', playerId: 'player2' })
    
    // Winning move
    const result = await matchService.claimSquare({ matchId: match.id, squareId: 2, selectionId: 'sel5', playerId: 'player1' })
    
    // Verify result
    expect(result.success).toBe(true)
    expect(result.matchState?.winner).toBe('P1')
    expect(result.matchState?.status).toBe('finished')
    
    // Verify result.decided log exists and has correct format
    const resultDecidedLogs = capturedLogs.filter(log => log.evt === 'result.decided')
    expect(resultDecidedLogs).toHaveLength(1)
    
    const log = resultDecidedLogs[0]
    expect(log).toMatchObject({
      evt: 'result.decided',
      matchId: match.id,
      winner: 'P1',
      line: [0, 1, 2],
      version: 5
    })
  })

  test('Server unit: Post-finish claim rejection with match_finished', async () => {
    // Create and finish a match
    const match = matchService.createMatch('room1', ['player1', 'player2'])
    
    // Play winning sequence
    await matchService.claimSquare({ matchId: match.id, squareId: 0, selectionId: 'sel1', playerId: 'player1' })
    await matchService.claimSquare({ matchId: match.id, squareId: 3, selectionId: 'sel2', playerId: 'player2' })
    await matchService.claimSquare({ matchId: match.id, squareId: 1, selectionId: 'sel3', playerId: 'player1' })
    await matchService.claimSquare({ matchId: match.id, squareId: 4, selectionId: 'sel4', playerId: 'player2' })
    await matchService.claimSquare({ matchId: match.id, squareId: 2, selectionId: 'sel5', playerId: 'player1' })
    
    // Clear logs
    capturedLogs = []
    
    // Try to claim after match finished
    const result = await matchService.claimSquare({ matchId: match.id, squareId: 5, selectionId: 'sel6', playerId: 'player2' })
    
    // Verify rejection
    expect(result.success).toBe(false)
    expect(result.reason).toBe('match_finished')
    
    // Verify claim.reject log
    const rejectLogs = capturedLogs.filter(log => log.evt === 'claim.reject')
    expect(rejectLogs).toHaveLength(1)
    
    expect(rejectLogs[0]).toMatchObject({
      evt: 'claim.reject',
      reason: 'match_finished',
      matchId: match.id,
      squareId: 5
    })
  })
})