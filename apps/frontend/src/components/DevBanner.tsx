import React from 'react'
import { useSocketStore } from '../stores/socketStore'

export const DevBanner: React.FC = () => {
  const { 
    connectionStatus, 
    currentRoom, 
    currentMatch, 
    matchState,
    socket 
  } = useSocketStore()

  if (process.env.NODE_ENV !== 'development') {
    return null
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'connected': return 'bg-green-600'
      case 'connecting': return 'bg-yellow-600'
      case 'disconnected': return 'bg-red-600'
      default: return 'bg-gray-600'
    }
  }

  const getCurrentState = () => {
    if (matchState || currentMatch) return 'In Match'
    if (currentRoom) return 'In Lobby'
    return 'Home Screen'
  }

  const getWebSocketUrl = () => {
    const wsUrl = import.meta.env.VITE_WS_URL
    return wsUrl || 'Not configured'
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-purple-900 bg-opacity-95 text-white text-xs p-2 border-b border-purple-600">
      <div className="container mx-auto flex flex-wrap items-center gap-4 justify-between">
        <div className="flex flex-wrap items-center gap-4">
          {/* Connection Status */}
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${getStatusColor(connectionStatus)}`} />
            <span>WS: {connectionStatus}</span>
          </div>

          {/* Socket ID */}
          {socket?.id && (
            <div className="flex items-center gap-1">
              <span className="text-purple-300">ID:</span>
              <span className="font-mono">{socket.id.slice(-6)}</span>
            </div>
          )}

          {/* Current State */}
          <div className="flex items-center gap-1">
            <span className="text-purple-300">State:</span>
            <span>{getCurrentState()}</span>
          </div>

          {/* Room Info */}
          {currentRoom && (
            <div className="flex items-center gap-1">
              <span className="text-purple-300">Room:</span>
              <span className="font-mono">{currentRoom.code}</span>
            </div>
          )}

          {/* Match Info */}
          {matchState && (
            <div className="flex items-center gap-1">
              <span className="text-purple-300">Match:</span>
              <span className="font-mono">{matchState.id.slice(-6)}</span>
            </div>
          )}
        </div>

        {/* WebSocket URL */}
        <div className="flex items-center gap-1 text-purple-200">
          <span>URL:</span>
          <span className="font-mono text-xs">{getWebSocketUrl()}</span>
        </div>
      </div>
    </div>
  )
}