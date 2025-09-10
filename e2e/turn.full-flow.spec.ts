import { test, expect, Page, ConsoleMessage } from '@playwright/test'

test.describe('Turn Mode Full Flow', () => {
  const consoleLogs: string[] = []
  const p1ConsoleLogs: string[] = []
  const p2ConsoleLogs: string[] = []

  // Helper to capture structured console logs
  const captureConsoleLogs = (page: Page, logs: string[]) => {
    page.on('console', (msg: ConsoleMessage) => {
      const text = msg.text()
      logs.push(`[${page.url().includes(':3001') ? 'P2' : 'P1'}] ${text}`)
      // Keep only last 20 logs per page
      if (logs.length > 20) {
        logs.shift()
      }
    })
  }

  // Helper to wait for a specific console log containing text
  const waitForConsoleLog = async (page: Page, searchText: string, timeout = 10000) => {
    return page.waitForFunction(
      ({ searchText }) => {
        return window.console && 
               // @ts-ignore - accessing stored console logs
               window.__e2eConsoleLogs?.some((log: string) => log.includes(searchText))
      },
      { searchText },
      { timeout }
    ).catch(() => {
      throw new Error(`Timeout waiting for console log containing: "${searchText}"`)
    })
  }

  // Helper to inject console log capture into page
  const injectConsoleCapture = async (page: Page) => {
    await page.addInitScript(() => {
      // @ts-ignore
      window.__e2eConsoleLogs = []
      const originalLog = console.log
      console.log = (...args) => {
        const message = args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' ')
        // @ts-ignore
        window.__e2eConsoleLogs.push(message)
        // Keep only last 20 logs
        // @ts-ignore
        if (window.__e2eConsoleLogs.length > 20) {
          // @ts-ignore
          window.__e2eConsoleLogs.shift()
        }
        originalLog.apply(console, args)
      }
    })
  }

  test('Two players complete match and rematch in turn mode', async ({ browser }) => {
    // Create two browser contexts for two players
    const context1 = await browser.newContext({ viewport: { width: 1280, height: 720 } })
    const context2 = await browser.newContext({ viewport: { width: 1280, height: 720 } })

    const p1 = await context1.newPage()
    const p2 = await context2.newPage()

    // Inject console capture
    await injectConsoleCapture(p1)
    await injectConsoleCapture(p2)

    // Capture console logs for debugging
    captureConsoleLogs(p1, p1ConsoleLogs)
    captureConsoleLogs(p2, p2ConsoleLogs)

    try {
      // Navigate both players to the app
      await p1.goto('/')
      await p2.goto('/')

      // Wait for both players to be connected
      await expect(p1.locator('text=🚀 Quick Match')).toBeVisible({ timeout: 10000 })
      await expect(p2.locator('text=🚀 Quick Match')).toBeVisible({ timeout: 10000 })

      // Both players click Quick Match
      await p1.click('text=🚀 Quick Match')
      await p2.click('text=🚀 Quick Match')

      // Wait for match to start - look for "Match started:" console log and game UI
      await Promise.race([
        waitForConsoleLog(p1, 'Match started:'),
        waitForConsoleLog(p2, 'Match started:')
      ])

      // Verify match screen is loaded
      await expect(p1.locator('text=Match Started!')).toBeVisible({ timeout: 5000 })
      await expect(p2.locator('text=Match Started!')).toBeVisible({ timeout: 5000 })

      // Wait for game board to be visible
      await expect(p1.locator('.grid-cols-3')).toBeVisible()
      await expect(p2.locator('.grid-cols-3')).toBeVisible()

      // Verify turn mode is active (should show current turn)
      await expect(p1.locator('.text-lg.font-semibold').filter({ hasText: 'Turn:' })).toBeVisible()
      await expect(p2.locator('.text-lg.font-semibold').filter({ hasText: 'Turn:' })).toBeVisible()

      // Determine which player is P1 (X) and P2 (O) by checking the UI
      const p1IsP1 = await p1.locator('text=You: P1').isVisible()
      const p1Player = p1IsP1 ? p1 : p2
      const p2Player = p1IsP1 ? p2 : p1

      console.log(`Player assignment: ${p1IsP1 ? 'P1=p1, P2=p2' : 'P1=p2, P2=p1'}`)

      // Execute deterministic moves: P1: 0,2,1 (wins row 0,1,2), P2: 4,7
      const moves = [
        { player: p1Player, square: 0, label: 'P1 claims 0' },
        { player: p2Player, square: 4, label: 'P2 claims 4' },
        { player: p1Player, square: 2, label: 'P1 claims 2' },
        { player: p2Player, square: 7, label: 'P2 claims 7' },
        { player: p1Player, square: 1, label: 'P1 claims 1 (wins)' }
      ]

      for (const move of moves) {
        console.log(`Executing move: ${move.label}`)
        
        // Click the square (index-based, 0-8 for 3x3 grid)
        const squareSelector = `.grid-cols-3 button:nth-child(${move.square + 1})`
        await move.player.click(squareSelector)
        
        // Wait a bit for the move to be processed
        await move.player.waitForTimeout(1000)
      }

      // Wait for game to finish and verify results
      await expect(p1Player.locator('text=You Win')).toBeVisible({ timeout: 5000 })
      await expect(p2Player.locator('text=You Lose')).toBeVisible({ timeout: 5000 })

      // Verify winning line is highlighted (squares 0, 1, 2 should have green color)
      const winningSquares = [0, 1, 2]
      for (const square of winningSquares) {
        const squareSelector = `.grid-cols-3 button:nth-child(${square + 1})`
        await expect(p1.locator(squareSelector).locator('.text-green-500')).toBeVisible()
      }

      // Verify rematch button is visible
      await expect(p1.locator('text=Rematch')).toBeVisible()
      await expect(p2.locator('text=Rematch')).toBeVisible()

      // P1 (winner) initiates rematch
      await p1Player.click('text=Rematch')

      // Verify rematch pending state
      await expect(p1Player.locator('text=Waiting for opponent...')).toBeVisible({ timeout: 3000 })
      await expect(p2Player.locator('text=Accept Rematch')).toBeVisible({ timeout: 3000 })

      // P2 accepts rematch  
      await p2Player.click('text=Accept Rematch')

      // Wait for new match to start - board should reset and new matchStart console log
      await Promise.race([
        waitForConsoleLog(p1, 'Match started:'),
        waitForConsoleLog(p2, 'Match started:')
      ])

      // Verify board is reset and game is active again
      await expect(p1.locator('.text-lg.font-semibold').filter({ hasText: 'Turn:' })).toBeVisible({ timeout: 5000 })
      await expect(p2.locator('.text-lg.font-semibold').filter({ hasText: 'Turn:' })).toBeVisible({ timeout: 5000 })

      // Verify board is empty (no X or O symbols)
      const emptySquares = await p1.locator('.grid-cols-3 button').count()
      expect(emptySquares).toBe(9)

      // Verify no winning text is shown
      await expect(p1.locator('text=You Win')).not.toBeVisible()
      await expect(p1.locator('text=You Lose')).not.toBeVisible()
      await expect(p2.locator('text=You Win')).not.toBeVisible()
      await expect(p2.locator('text=You Lose')).not.toBeVisible()

      console.log('Turn mode E2E test completed successfully')

    } catch (error) {
      console.error('E2E Test failed:', error)
      console.error('P1 Console logs:', p1ConsoleLogs.slice(-20))
      console.error('P2 Console logs:', p2ConsoleLogs.slice(-20))
      throw error
    } finally {
      await context1.close()
      await context2.close()
    }
  })
})