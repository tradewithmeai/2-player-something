import React from 'react'
import { useSocketStore, Room } from '../stores/socketStore'

interface LobbyScreenProps {
  room: Room
}

export const LobbyScreen: React.FC<LobbyScreenProps> = ({ room }) => {
  const { leaveRoom, setPlayerReady } = useSocketStore()

  const currentPlayerId = useSocketStore(state => state.socket?.id)
  const currentPlayer = room.players.find(p => p.id === currentPlayerId)
  const otherPlayers = room.players.filter(p => p.id !== currentPlayerId)
  
  const allPlayersReady = room.players.length === room.maxPlayers && room.players.every(p => p.isReady)
  const canStart = room.players.length === room.maxPlayers

  const handleReadyToggle = () => {
    if (currentPlayer) {
      setPlayerReady(!currentPlayer.isReady)
    }
  }

  const formatDate = (date: string | Date) => {
    const d = typeof date === 'string' ? new Date(date) : date
    return d.toLocaleTimeString()
  }

  const getStatusColor = () => {
    switch (room.status) {
      case 'waiting': return 'text-yellow-500'
      case 'active': return 'text-green-500'
      case 'finished': return 'text-gray-500'
      default: return 'text-gray-400'
    }
  }

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="max-w-lg w-full space-y-6">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white mb-2">Game Lobby</h1>
          <div className="bg-gray-800 rounded-lg p-4">
            <p className="text-2xl font-mono text-blue-400 font-bold">{room.code}</p>
            <p className="text-gray-400 text-sm">Share this code with your friend</p>
          </div>
        </div>

        {/* Room Status */}
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-white font-medium">Room Status</span>
            <span className={`font-medium ${getStatusColor()}`}>
              {room.status.charAt(0).toUpperCase() + room.status.slice(1)}
            </span>
          </div>
          <div className="flex justify-between text-sm text-gray-400">
            <span>Players: {room.players.length}/{room.maxPlayers}</span>
            <span>Type: {room.isPublic ? 'Public' : 'Private'}</span>
          </div>
        </div>

        {/* Players List */}
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="text-white font-medium mb-4">Players</h3>
          <div className="space-y-3">
            {/* Current Player */}
            {currentPlayer && (
              <div className="flex items-center justify-between bg-blue-900 bg-opacity-50 rounded-lg p-3 border border-blue-500">
                <div className="flex items-center space-x-3">
                  <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                  <div>
                    <p className="text-white font-medium">You</p>
                    <p className="text-gray-400 text-sm">
                      Joined {formatDate(currentPlayer.joinedAt)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <span className={`text-sm ${currentPlayer.isReady ? 'text-green-400' : 'text-gray-400'}`}>
                    {currentPlayer.isReady ? 'Ready' : 'Not Ready'}
                  </span>
                  {room.status === 'waiting' && (
                    <button
                      onClick={handleReadyToggle}
                      className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                        currentPlayer.isReady 
                          ? 'bg-red-600 hover:bg-red-700 text-white' 
                          : 'bg-green-600 hover:bg-green-700 text-white'
                      }`}
                    >
                      {currentPlayer.isReady ? 'Not Ready' : 'Ready'}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Other Players */}
            {otherPlayers.map((player) => (
              <div key={player.id} className="flex items-center justify-between bg-gray-700 rounded-lg p-3">
                <div className="flex items-center space-x-3">
                  <div className="w-3 h-3 rounded-full bg-green-500"></div>
                  <div>
                    <p className="text-white font-medium">Player {player.id.slice(-4)}</p>
                    <p className="text-gray-400 text-sm">
                      Joined {formatDate(player.joinedAt)}
                    </p>
                  </div>
                </div>
                <span className={`text-sm ${player.isReady ? 'text-green-400' : 'text-gray-400'}`}>
                  {player.isReady ? 'Ready' : 'Not Ready'}
                </span>
              </div>
            ))}

            {/* Empty Slots */}
            {Array.from({ length: room.maxPlayers - room.players.length }, (_, i) => (
              <div key={`empty-${i}`} className="flex items-center justify-between bg-gray-700 bg-opacity-50 rounded-lg p-3 border-2 border-dashed border-gray-600">
                <div className="flex items-center space-x-3">
                  <div className="w-3 h-3 rounded-full bg-gray-600"></div>
                  <div>
                    <p className="text-gray-500 font-medium">Waiting for player...</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Game Status / Actions */}
        {room.status === 'waiting' && (
          <div className="bg-gray-800 rounded-lg p-4">
            {canStart ? (
              <div className="text-center">
                {allPlayersReady ? (
                  <div>
                    <div className="animate-pulse text-4xl mb-2">🚀</div>
                    <p className="text-green-400 font-medium">All players ready! Starting game...</p>
                  </div>
                ) : (
                  <div>
                    <div className="text-4xl mb-2">⏳</div>
                    <p className="text-yellow-400 font-medium">Waiting for all players to be ready</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center">
                <div className="text-4xl mb-2">👥</div>
                <p className="text-blue-400 font-medium">Waiting for more players to join</p>
                <p className="text-gray-400 text-sm mt-1">Share the room code: {room.code}</p>
              </div>
            )}
          </div>
        )}

        {room.status === 'active' && (
          <div className="bg-green-900 bg-opacity-50 rounded-lg p-4 border border-green-500 text-center">
            <div className="text-4xl mb-2">🎮</div>
            <p className="text-green-400 font-medium text-lg">Game in Progress!</p>
            <p className="text-gray-400 text-sm">Match started {room.matchStartedAt && formatDate(room.matchStartedAt)}</p>
          </div>
        )}

        {/* Leave Room Button */}
        <button
          onClick={leaveRoom}
          className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-3 px-4 rounded-lg transition-colors"
        >
          Leave Room
        </button>
      </div>
    </div>
  )
}