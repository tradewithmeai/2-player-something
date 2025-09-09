import React from 'react'
import { useSocketStore, Match } from '../stores/socketStore'
import { TicTacToeBoard } from './TicTacToeBoard'

interface MatchScreenProps {
  match: Match
}

export const MatchScreen: React.FC<MatchScreenProps> = ({ match }) => {
  const { leaveRoom, matchState, mySeat } = useSocketStore()
  
  const currentPlayerId = useSocketStore(state => state.socket?.id)
  
  // Safely compute opponent from store state
  const players = match.players || []
  const currentPlayer = players.find(p => p.id === currentPlayerId)
  
  // Derive opponent seat and find opponent safely
  const opponentSeat = mySeat === 'P1' ? 'P2' : 'P1'
  const opponent = players.find(p => 
    // First try to find by seat if seats are available
    (p as any).seat === opponentSeat ||
    // Fallback: find by "not me"
    (p.id !== currentPlayerId)
  )
  
  // Safe opponent ID extraction
  const opponentId = opponent?.id
  const opponentDisplay = opponentId?.slice(-6) ?? '—'

  const formatDate = (date: string | Date | undefined) => {
    if (!date) return 'Unknown'
    const d = typeof date === 'string' ? new Date(date) : date
    return d.toLocaleString()
  }

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="max-w-lg w-full space-y-6">
        {/* Header */}
        <div className="text-center">
          <div className="text-6xl mb-4 animate-bounce">🎮</div>
          <h1 className="text-3xl font-bold text-white mb-2">Match Started!</h1>
          <p className="text-gray-400">Game began {formatDate(match.startedAt)}</p>
        </div>

        {/* Match Info */}
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="text-white font-medium mb-3">Match Information</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Match ID:</span>
              <span className="text-white font-mono">{matchState?.id || 'Loading...'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Room ID:</span>
              <span className="text-white font-mono">{match.roomId}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Players:</span>
              <span className="text-white">{match.players.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Started:</span>
              <span className="text-white">{formatDate(match.startedAt)}</span>
            </div>
          </div>
        </div>

        {/* Players in Match */}
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="text-white font-medium mb-4">Players</h3>
          <div className="grid grid-cols-2 gap-4">
            {/* Current Player */}
            {currentPlayer && (
              <div className="bg-blue-900 bg-opacity-50 rounded-lg p-4 border border-blue-500 text-center">
                <div className="w-12 h-12 bg-blue-500 rounded-full mx-auto mb-3 flex items-center justify-center">
                  <span className="text-white font-bold text-lg">Y</span>
                </div>
                <p className="text-white font-medium">You</p>
                <p className="text-blue-400 text-sm">Player 1</p>
              </div>
            )}

            {/* Opponent */}
            {opponent && (
              <div className="bg-red-900 bg-opacity-50 rounded-lg p-4 border border-red-500 text-center">
                <div className="w-12 h-12 bg-red-500 rounded-full mx-auto mb-3 flex items-center justify-center">
                  <span className="text-white font-bold text-lg">O</span>
                </div>
                <p className="text-white font-medium">Opponent</p>
                <p className="text-red-400 text-sm">Player {opponentDisplay}</p>
              </div>
            )}
          </div>
        </div>

        {/* Tic-Tac-Toe Game Board */}
        <div className="bg-gray-800 rounded-lg p-8 text-center">
          <TicTacToeBoard />
        </div>

        {/* Match Actions */}
        <div className="space-y-3">
          <button
            onClick={leaveRoom}
            className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-3 px-4 rounded-lg transition-colors"
          >
            Leave Match
          </button>
        </div>

        {/* Dev Footer */}
        <div className="bg-gray-700 rounded-lg p-3 text-center border-t border-gray-600">
          <div className="text-xs text-gray-400 space-y-1">
            <div>🔧 Dev Info</div>
            <div>MatchId: <span className="font-mono text-gray-300">{matchState?.id || 'Not loaded'}</span></div>
          </div>
        </div>
      </div>
    </div>
  )
}