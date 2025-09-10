import { useSocketStore } from '../socketStore'

export const resetStore = () => {
  const mode = import.meta.env.VITE_MATCH_MODE || 'turn'
  
  useSocketStore.setState({
    socket: null,
    isConnected: false,
    connectionStatus: 'disconnected',
    handlersAttached: false,
    currentRoom: null,
    inQueue: false,
    publicRooms: [],
    currentMatch: null,
    matchState: null,
    pendingClaims: new Map(),
    playerId: null,
    mySeat: null,
    gameInputLocked: false,
    isFinished: false,
    rematchPending: false,
    matchFinishedNotice: null,
    matchMode: mode as 'turn' | 'simul',
    currentWindowId: null,
    windowDeadline: null,
    pendingSimulClaims: new Map(),
    lastPong: null,
    serverTime: null,
    rematchRequesterSeat: null
  })
}

export const isSimul = (): boolean => {
  return (import.meta.env.VITE_MATCH_MODE || 'turn') === 'simul'
}

export const isTurn = (): boolean => {
  return (import.meta.env.VITE_MATCH_MODE || 'turn') === 'turn'
}