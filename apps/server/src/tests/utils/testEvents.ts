import { Socket } from 'socket.io-client'

export interface WaitForSocketEventOptions {
  timeoutMs?: number
  count?: number
}

export interface WaitForMatchVersionOptions {
  timeoutMs?: number
}

/**
 * Wait for specific socket events to be emitted
 */
export function waitForSocketEvent(
  socket: Socket,
  eventName: string,
  options: WaitForSocketEventOptions = {}
): Promise<any[]> {
  const { timeoutMs = 2000, count = 1 } = options
  
  return new Promise((resolve, reject) => {
    const events: any[] = []
    let timeoutId: NodeJS.Timeout
    
    const cleanup = () => {
      clearTimeout(timeoutId)
      socket.off(eventName, eventHandler)
    }
    
    const eventHandler = (data: any) => {
      events.push(data)
      if (events.length >= count) {
        cleanup()
        resolve(events)
      }
    }
    
    timeoutId = setTimeout(() => {
      cleanup()
      reject(new Error(`Timeout waiting for ${count} ${eventName} event(s) after ${timeoutMs}ms. Received: ${events.length}`))
    }, timeoutMs)
    
    socket.on(eventName, eventHandler)
  })
}

/**
 * Wait for multiple socket events to be emitted on different sockets
 */
export function waitForMultipleSocketEvents(
  eventSpecs: Array<{ socket: Socket; eventName: string; count?: number }>,
  options: WaitForSocketEventOptions = {}
): Promise<any[][]> {
  const { timeoutMs = 2000 } = options
  
  return new Promise((resolve, reject) => {
    const results: any[][] = new Array(eventSpecs.length).fill(null).map(() => [])
    let completedSpecs = 0
    let timeoutId: NodeJS.Timeout
    
    const cleanup = () => {
      clearTimeout(timeoutId)
      eventSpecs.forEach(({ socket, eventName }, index) => {
        socket.off(eventName, handlers[index])
      })
    }
    
    const checkCompletion = () => {
      if (completedSpecs === eventSpecs.length) {
        cleanup()
        resolve(results)
      }
    }
    
    const handlers = eventSpecs.map(({ count = 1 }, index) => {
      return (data: any) => {
        results[index].push(data)
        if (results[index].length >= count) {
          completedSpecs++
          checkCompletion()
        }
      }
    })
    
    timeoutId = setTimeout(() => {
      cleanup()
      const summary = eventSpecs.map(({ eventName }, i) => 
        `${eventName}: ${results[i].length}/${eventSpecs[i].count || 1}`
      ).join(', ')
      reject(new Error(`Timeout waiting for events after ${timeoutMs}ms. Status: ${summary}`))
    }, timeoutMs)
    
    eventSpecs.forEach(({ socket, eventName }, index) => {
      socket.on(eventName, handlers[index])
    })
  })
}

/**
 * Wait for a match to reach a specific version (polling-based)
 */
export function waitForMatchVersion(
  matchService: any,
  matchId: string,
  targetVersion: number,
  options: WaitForMatchVersionOptions = {}
): Promise<any> {
  const { timeoutMs = 2000 } = options
  const pollInterval = 50
  
  return new Promise((resolve, reject) => {
    const startTime = Date.now()
    
    const poll = () => {
      const match = matchService.getMatch(matchId)
      if (match && match.version >= targetVersion) {
        resolve(match)
        return
      }
      
      if (Date.now() - startTime >= timeoutMs) {
        reject(new Error(`Timeout waiting for match ${matchId} to reach version ${targetVersion}. Current: ${match?.version || 'none'}`))
        return
      }
      
      setTimeout(poll, pollInterval)
    }
    
    poll()
  })
}

/**
 * Get current match mode from environment
 */
export function getMode(): 'turn' | 'simul' {
  return (process.env.MATCH_MODE || 'turn') as 'turn' | 'simul'
}

/**
 * Skip test if not in the expected mode
 */
export function skipIfNotMode(expectedMode: 'turn' | 'simul', testName: string) {
  const currentMode = getMode()
  if (currentMode !== expectedMode) {
    console.log(`Skipping ${testName} (mode: ${currentMode}, expected: ${expectedMode})`)
    return true
  }
  return false
}