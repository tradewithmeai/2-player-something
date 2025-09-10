import { io, Socket } from 'socket.io-client'

interface ClientState {
  socketId: string | null
  matchId: string | null
  mySeat: 'P1' | 'P2' | null
  currentTurn: 'P1' | 'P2' | null
  version: number
}

export class TestClient {
  private socket: Socket | null = null
  private state: ClientState = {
    socketId: null,
    matchId: null,
    mySeat: null,
    currentTurn: null,
    version: 0
  }
  private eventCallbacks = new Map<string, ((data: any) => void)[]>()

  constructor(private serverUrl: string = 'http://localhost:8890/game') {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = io(this.serverUrl, {
        transports: ['websocket'],
        timeout: 5000
      })

      this.socket.on('connect', () => {
        this.state.socketId = this.socket!.id
        this.setupEventHandlers()
        resolve()
      })

      this.socket.on('connect_error', (error) => {
        reject(new Error(`Connection failed: ${error.message}`))
      })

      // Set connection timeout
      setTimeout(() => {
        if (!this.socket?.connected) {
          reject(new Error('Connection timeout'))
        }
      }, 5000)
    })
  }

  private setupEventHandlers(): void {
    if (!this.socket) return

    // Handle matchStart - store match info, ignore duplicates
    this.socket.on('matchStart', (data: any) => {
      if (this.state.matchId && this.state.matchId === data.matchId) {
        // Ignore duplicate matchStart for same matchId
        return
      }
      
      this.state.matchId = data.matchId
      this.state.mySeat = data.mySeat
      this.state.currentTurn = data.currentTurn || 'P1'
      this.state.version = data.version || 0
      
      this.emitToCallbacks('matchStart', data)
    })

    // Handle stateSync and matchStateUpdate - update version/turn, ignore stale
    this.socket.on('stateSync', (data: any) => {
      if (data.matchId && data.matchId !== this.state.matchId) return
      if (data.version < this.state.version) return
      
      this.state.version = data.version
      this.state.currentTurn = data.currentTurn
      
      this.emitToCallbacks('stateSync', data)
    })

    this.socket.on('matchStateUpdate', (data: any) => {
      if (data.matchId && data.matchId !== this.state.matchId) return
      if (data.version < this.state.version) return
      
      this.state.version = data.version
      this.state.currentTurn = data.currentTurn
      
      this.emitToCallbacks('matchStateUpdate', data)
    })

    // Forward all other events to callbacks
    const forwardedEvents = [
      'quickMatchFound', 'squareClaimed', 'claim', 'result', 'gameResult', 
      'rematchPending', 'rematchAccepted', 'error'
    ]
    
    forwardedEvents.forEach(eventName => {
      this.socket!.on(eventName, (data: any) => {
        this.emitToCallbacks(eventName, data)
      })
    })
  }

  private emitToCallbacks(eventName: string, data: any): void {
    const callbacks = this.eventCallbacks.get(eventName) || []
    callbacks.forEach(callback => {
      try {
        callback(data)
      } catch (error) {
        console.error(`Error in event callback for ${eventName}:`, error)
      }
    })
  }

  async quickMatch(): Promise<void> {
    if (!this.socket?.connected) {
      throw new Error('Socket not connected')
    }

    // Just wait for matchStart - the server doesn't emit quickMatchFound
    const matchStartPromise = this.awaitEvent('matchStart', 5000)
    
    // Emit quickMatch request
    this.socket.emit('quickMatch')
    
    // Wait for matchStart
    await matchStartPromise
  }

  async awaitEvent(eventName: string, timeoutMs: number = 1500): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        // Remove callback
        const callbacks = this.eventCallbacks.get(eventName) || []
        const index = callbacks.indexOf(callback)
        if (index > -1) {
          callbacks.splice(index, 1)
        }
        reject(new Error(`Timeout waiting for event: ${eventName} (${timeoutMs}ms)`))
      }, timeoutMs)

      const callback = (data: any) => {
        clearTimeout(timeout)
        // Remove this specific callback
        const callbacks = this.eventCallbacks.get(eventName) || []
        const index = callbacks.indexOf(callback)
        if (index > -1) {
          callbacks.splice(index, 1)
        }
        resolve(data)
      }

      // Add callback
      if (!this.eventCallbacks.has(eventName)) {
        this.eventCallbacks.set(eventName, [])
      }
      this.eventCallbacks.get(eventName)!.push(callback)
    })
  }

  claimSquare(squareId: number, selectionId?: string): void {
    if (!this.socket?.connected) {
      throw new Error('Socket not connected')
    }
    
    if (!this.state.matchId) {
      throw new Error('No active match - must join match before claiming squares')
    }

    const finalSelectionId = selectionId || `claim_${Date.now()}_${Math.random().toString(36).slice(2)}`

    this.socket.emit('claimSquare', {
      matchId: this.state.matchId,
      squareId,
      selectionId: finalSelectionId
    })
  }

  emit(eventName: string, data?: any): void {
    if (!this.socket?.connected) {
      throw new Error('Socket not connected')
    }
    this.socket.emit(eventName, data)
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
    }
    this.eventCallbacks.clear()
    this.state = {
      socketId: null,
      matchId: null,
      mySeat: null,
      currentTurn: null,
      version: 0
    }
  }

  getState(): Readonly<ClientState> {
    return { ...this.state }
  }
}

export function makeClient(serverUrl: string = 'http://localhost:8890/game'): TestClient {
  return new TestClient(serverUrl)
}