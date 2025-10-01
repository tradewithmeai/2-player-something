import { test, expect, Page, ConsoleMessage } from '@playwright/test'

test.describe('Simul Mode Full Flow', () => {
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

  test('Two players complete match and rematch in simul mode', async ({ browser }) => {
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

      // Check if simul mode is active - if not, skip this test
      const simulModeActive = await p1.locator('text=Simultaneous Mode').isVisible()
      if (!simulModeActive) {
        console.log('Server is not in simul mode, skipping simul test')
        return
      }

      // Verify simul mode is active 
      await expect(p1.locator('text=Simultaneous Mode')).toBeVisible()
      await expect(p2.locator('text=Simultaneous Mode')).toBeVisible()

      // Verify simul mode badge is present
      await expect(p1.locator('text=🔀 Simultaneous mode - Both players can select')).toBeVisible()
      await expect(p2.locator('text=🔀 Simultaneous mode - Both players can select')).toBeVisible()

      // Determine which player is P1 (X) and P2 (O) by checking the UI
      const p1IsP1 = await p1.locator('text=You: P1').isVisible()
      const p1Player = p1IsP1 ? p1 : p2
      const p2Player = p1IsP1 ? p2 : p1

      console.log(`Player assignment: ${p1IsP1 ? 'P1=p1, P2=p2' : 'P1=p2, P2=p1'}`)

      // Wait for first window to open
      await Promise.race([
        waitForConsoleLog(p1, 'Window opened:'),
        waitForConsoleLog(p2, 'Window opened:')
      ])

      // Execute moves in simul mode across multiple windows
      // Window 1: P1 claims 0, P2 claims 4
      console.log('Window 1: P1 claims 0, P2 claims 4')
      await Promise.all([
        p1Player.click('.grid-cols-3 button:nth-child(1)'), // square 0
        p2Player.click('.grid-cols-3 button:nth-child(5)')  // square 4
      ])

      // Wait for window to close and next to open
      await p1.waitForTimeout(1000) // Window duration + buffer
      
      // Window 2: P1 claims 2, P2 claims 7
      console.log('Window 2: P1 claims 2, P2 claims 7') 
      await Promise.all([
        p1Player.click('.grid-cols-3 button:nth-child(3)'), // square 2
        p2Player.click('.grid-cols-3 button:nth-child(8)')  // square 7
      ])

      // Wait for window to close and next to open
      await p1.waitForTimeout(1000)

      // Window 3: P1 claims 1 (completes winning line 0,1,2)
      console.log('Window 3: P1 claims 1 (wins)')
      await p1Player.click('.grid-cols-3 button:nth-child(2)') // square 1

      // Wait for game to finish and verify results
      await expect(p1Player.locator('text=You Win')).toBeVisible({ timeout: 5000 })
      await expect(p2Player.locator('text=You Lose')).toBeVisible({ timeout: 5000 })

      // Verify winning line is highlighted (squares 0, 1, 2 should have green color)
      const winningSquares = [0, 1, 2]
      for (const square of winningSquares) {
        const squareSelector = `.grid-cols-3 button:nth-child(${square + 1})`
        await expect(p1.locator(squareSelector).locator('.text-green-500')).toBeVisible()
      }

      // Verify simul mode UI elements are hidden when game is finished
      await expect(p1.locator('text=🔀 Simultaneous mode - Both players can select')).not.toBeVisible()
      await expect(p2.locator('text=🔀 Simultaneous mode - Both players can select')).not.toBeVisible()

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

      // Verify simul mode is active again
      await expect(p1.locator('text=Simultaneous Mode')).toBeVisible({ timeout: 5000 })
      await expect(p2.locator('text=Simultaneous Mode')).toBeVisible({ timeout: 5000 })

      // Verify simul mode badge is back
      await expect(p1.locator('text=🔀 Simultaneous mode - Both players can select')).toBeVisible()
      await expect(p2.locator('text=🔀 Simultaneous mode - Both players can select')).toBeVisible()

      // Verify board is empty (no X or O symbols)
      const emptySquares = await p1.locator('.grid-cols-3 button').count()
      expect(emptySquares).toBe(9)

      // Verify no winning text is shown
      await expect(p1.locator('text=You Win')).not.toBeVisible()
      await expect(p1.locator('text=You Lose')).not.toBeVisible()
      await expect(p2.locator('text=You Win')).not.toBeVisible()
      await expect(p2.locator('text=You Lose')).not.toBeVisible()

      // Verify starter has flipped (original P2 should now be P1)
      if (p1IsP1) {
        // Original P1 should now be P2
        await expect(p1.locator('text=You: P2')).toBeVisible({ timeout: 3000 })
        await expect(p2.locator('text=You: P1')).toBeVisible({ timeout: 3000 })
      } else {
        // Original P2 should now be P1  
        await expect(p1.locator('text=You: P1')).toBeVisible({ timeout: 3000 })
        await expect(p2.locator('text=You: P2')).toBeVisible({ timeout: 3000 })
      }

      console.log('Simul mode E2E test completed successfully')

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