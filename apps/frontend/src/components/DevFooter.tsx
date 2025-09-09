import { useEffect } from 'react'
import { useSocketStore } from '../stores/socketStore'

const SERVER_URL = import.meta.env.VITE_WS_URL || 'http://localhost:8002'
const NAMESPACE = '/game'

export function DevFooter() {
  const { matchState, mySeat, isFinished } = useSocketStore()

  useEffect(() => {
    // Log WebSocket URL on mount
    console.log(JSON.stringify({
      evt: 'frontend.ws.url',
      url: `${SERVER_URL}${NAMESPACE}`
    }))
  }, [])

  if (!import.meta.env.DEV) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-black bg-opacity-80 text-white text-xs font-mono p-2 z-50">
      {matchState ? (
        <div className="space-x-4">
          <span>seat: {mySeat}</span>
          <span>turn: {matchState.currentTurn}</span>
          <span>version: {matchState.version}</span>
          <span>finished: {isFinished ? 'true' : 'false'}</span>
          <span>match: {matchState.id.split('_').pop()}</span>
        </div>
      ) : (
        <span>No match state</span>
      )}
    </div>
  )
}