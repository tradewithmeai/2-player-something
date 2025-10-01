// Simplified Dynamic Game Component - loads games from simple static registry
import React from 'react'
import { GAMES, GameType, GAME_INFO } from './GameRegistry'
import { useSocketStore } from '../stores/socketStore'

interface DynamicGameComponentProps {
  className?: string
  showDebugInfo?: boolean
}

export const DynamicGameComponent: React.FC<DynamicGameComponentProps> = ({
  className = '',
  showDebugInfo = false
}) => {
  const { matchState, mySeat, claimSquare, requestRematch } = useSocketStore()

  // Simple game type detection from match state
  const gameType: GameType = matchState?.gameType || 'tictactoe'

  // Get the game component from simple registry
  const GameComponent = GAMES[gameType]

  // Basic validation
  if (!matchState) {
    return (
      <div className={`text-center p-8 ${className}`}>
        <p className="text-gray-500">Loading match...</p>
      </div>
    )
  }

  if (!GameComponent) {
    return (
      <div className={`text-center p-8 ${className}`}>
        <p className="text-red-500">Game not implemented: {gameType}</p>
        {showDebugInfo && (
          <div className="mt-4 text-xs text-gray-500 font-mono">
            <div>Available games: {Object.keys(GAMES).join(', ')}</div>
            <div>Requested game: {gameType}</div>
          </div>
        )}
      </div>
    )
  }

  // Simple turn calculation
  const isMyTurn = matchState.currentTurn === mySeat

  return (
    <div className={className}>
      {showDebugInfo && (
        <div className="mb-4 text-xs text-gray-500 border border-gray-600 rounded p-2 font-mono">
          <div>Game: {GAME_INFO[gameType]?.name || gameType}</div>
          <div>My Seat: {mySeat}</div>
          <div>Current Turn: {matchState.currentTurn}</div>
          <div>Is My Turn: {isMyTurn ? 'Yes' : 'No'}</div>
          <div>Winner: {matchState.winner || 'None'}</div>
        </div>
      )}

      {mySeat && (
        <GameComponent
          matchState={matchState}
          mySeat={mySeat}
          isMyTurn={isMyTurn}
          onAction={claimSquare}
          onRematch={requestRematch}
        />
      )}
      {!mySeat && (
        <div className="text-center text-gray-500">
          Waiting to join match...
        </div>
      )}
    </div>
  )
}