import React, { useState, useEffect } from 'react'
import { useSocketStore } from '../stores/socketStore'

export const HomeScreen: React.FC = () => {
  const [joinCode, setJoinCode] = useState('')
  const [showPublicRooms, setShowPublicRooms] = useState(false)
  
  const {
    isConnected,
    inQueue,
    publicRooms,
    quickMatch,
    createRoom,
    joinRoom,
    getPublicRooms,
  } = useSocketStore()

  useEffect(() => {
    if (showPublicRooms && isConnected) {
      getPublicRooms()
      const interval = setInterval(getPublicRooms, 3000) // Refresh every 3 seconds
      return () => clearInterval(interval)
    }
  }, [showPublicRooms, isConnected, getPublicRooms])

  const handleQuickMatch = () => {
    if (isConnected) {
      quickMatch()
    }
  }

  const handleCreateRoom = (isPublic: boolean) => {
    if (isConnected) {
      createRoom(isPublic)
    }
  }

  const handleJoinRoom = (code?: string) => {
    const roomCode = code || joinCode.trim().toUpperCase()
    if (isConnected && roomCode) {
      joinRoom(roomCode)
    }
  }

  const formatRoomCode = (code: string) => {
    // Format as user types: ROOM-ABC123
    const cleaned = code.replace(/[^A-Z0-9]/g, '')
    if (cleaned.length <= 4) return cleaned
    return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 10)}`
  }

  const handleJoinCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatRoomCode(e.target.value.toUpperCase())
    setJoinCode(formatted)
  }

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-white">Connecting to server...</p>
        </div>
      </div>
    )
  }

  if (inQueue) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-pulse text-4xl mb-4">🔍</div>
          <h2 className="text-2xl font-bold text-white mb-2">Finding Match...</h2>
          <p className="text-gray-400">Looking for another player</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-6">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-4xl font-bold text-white mb-2">2 Player Game</h1>
          <p className="text-gray-400">Choose how to play</p>
        </div>

        {/* Quick Match Button */}
        <button
          onClick={handleQuickMatch}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-6 rounded-lg text-xl transition-colors"
        >
          🚀 Quick Match
        </button>

        {/* Join by Code */}
        <div className="space-y-2">
          <label className="text-white font-medium">Join by Code</label>
          <div className="flex space-x-2">
            <input
              type="text"
              value={joinCode}
              onChange={handleJoinCodeChange}
              placeholder="ROOM-ABC123"
              className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
              maxLength={10}
            />
            <button
              onClick={() => handleJoinRoom()}
              disabled={!joinCode.trim()}
              className="bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold px-6 py-3 rounded-lg transition-colors"
            >
              Join
            </button>
          </div>
        </div>

        {/* Create Room Options */}
        <div className="space-y-2">
          <label className="text-white font-medium">Create Room</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handleCreateRoom(false)}
              className="bg-gray-700 hover:bg-gray-600 text-white font-medium py-3 px-4 rounded-lg transition-colors"
            >
              🔒 Private
            </button>
            <button
              onClick={() => handleCreateRoom(true)}
              className="bg-gray-700 hover:bg-gray-600 text-white font-medium py-3 px-4 rounded-lg transition-colors"
            >
              🌐 Public
            </button>
          </div>
        </div>

        {/* Public Rooms Toggle */}
        <button
          onClick={() => setShowPublicRooms(!showPublicRooms)}
          className="w-full bg-gray-800 hover:bg-gray-700 text-white font-medium py-3 px-4 rounded-lg transition-colors text-left"
        >
          {showPublicRooms ? '🔽' : '▶️'} Public Rooms ({publicRooms.length})
        </button>

        {/* Public Rooms List */}
        {showPublicRooms && (
          <div className="bg-gray-800 rounded-lg p-4 max-h-60 overflow-y-auto">
            {publicRooms.length === 0 ? (
              <p className="text-gray-400 text-center py-4">No public rooms available</p>
            ) : (
              <div className="space-y-2">
                {publicRooms.map((room) => (
                  <div
                    key={room.id}
                    className="flex items-center justify-between bg-gray-700 rounded-lg p-3"
                  >
                    <div>
                      <p className="text-white font-medium">{room.code}</p>
                      <p className="text-gray-400 text-sm">
                        {room.players.length}/{room.maxPlayers} players
                      </p>
                    </div>
                    <button
                      onClick={() => handleJoinRoom(room.code)}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded transition-colors"
                    >
                      Join
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}