// TicTacToe Game Component adapted for multi-game system

import React, { useMemo, useCallback } from 'react'
import { GameComponentProps } from '../../types/gameTypes'

export const TicTacToe: React.FC<GameComponentProps> = ({
  matchState,
  mySeat,
  isMyTurn,
  isFinished,
  onGameAction,
  onRematch,
  className = '',
  showDebugInfo = false
}) => {
  // Convert match state to TicTacToe format
  const gameData = useMemo(() => {
    if (!matchState) {
      return {
        board: Array(9).fill(null),
        winner: null,
        winningLine: null
      }
    }

    return {
      board: matchState.board || Array(9).fill(null),
      winner: matchState.winner,
      winningLine: matchState.winningLine || null
    }
  }, [matchState])

  // Handle game actions
  const handleSquareClick = useCallback((squareIndex: number) => {
    if (isFinished || !isMyTurn || gameData.board[squareIndex]) return

    onGameAction({
      type: 'CLAIM_SQUARE',
      payload: { squareId: squareIndex },
      timestamp: Date.now()
    })
  }, [isFinished, isMyTurn, gameData.board, onGameAction])

  // Handle rematch
  const handleRematch = useCallback(() => {
    onRematch()
  }, [onRematch])

  const getSquareContent = (squareIndex: number) => {
    const player = gameData.board[squareIndex]
    if (!player) return null

    const isWinningSquare = gameData.winningLine?.includes(squareIndex)
    const symbol = player === 'P1' ? 'X' : 'O'

    return (
      <div className={`text-4xl font-bold ${isWinningSquare ? 'text-green-500' : 'text-blue-600'}`}>
        {symbol}
      </div>
    )
  }

  const getSquareClasses = (squareIndex: number) => {
    const baseClasses = 'w-20 h-20 border-2 border-gray-300 flex items-center justify-center cursor-pointer transition-all duration-200'

    if (isFinished || !isMyTurn || gameData.board[squareIndex]) {
      return `${baseClasses} cursor-not-allowed bg-gray-100`
    }

    return `${baseClasses} hover:bg-blue-50 bg-white`
  }

  const getGameStatus = () => {
    if (isFinished) {
      if (gameData.winner === 'draw') {
        return <div className="text-xl font-bold text-yellow-600">Draw</div>
      } else if (gameData.winner) {
        return (
          <div className="text-xl font-bold text-green-600">
            {gameData.winner === mySeat ? 'You Win!' : 'You Lose'}
          </div>
        )
      } else {
        return <div className="text-xl font-bold text-gray-600">Game Over</div>
      }
    }

    return (
      <div className="text-lg font-semibold">
        {isMyTurn ? (
          <span className="text-green-600">Your Turn</span>
        ) : (
          <span className="text-orange-600">Opponent's Turn</span>
        )}
      </div>
    )
  }

  const getPlayerSymbol = (seat: 'P1' | 'P2') => {
    return seat === 'P1' ? 'X' : 'O'
  }

  if (!matchState) {
    return (
      <div className={`flex items-center justify-center p-8 ${className}`}>
        <div className="text-gray-400">No active match</div>
      </div>
    )
  }

  return (
    <div className={`flex flex-col items-center space-y-6 ${className}`}>
      {/* Player Info */}
      <div className="text-center space-y-2">
        <div className="text-sm text-gray-600">
          You are: {getPlayerSymbol(mySeat!)} ({mySeat})
        </div>
        {getGameStatus()}
      </div>

      {/* Game Instructions */}
      {!isFinished && (
        <div className="text-center text-sm text-gray-500">
          {isMyTurn ? (
            <div>Click a square to place your {getPlayerSymbol(mySeat!)}</div>
          ) : (
            <div>Waiting for opponent...</div>
          )}
        </div>
      )}

      {/* 3x3 Grid */}
      <div className="grid grid-cols-3 gap-1 border-4 border-gray-400 p-2 bg-gray-200">
        {Array.from({ length: 9 }, (_, index) => (
          <button
            key={index}
            className={getSquareClasses(index)}
            onClick={() => handleSquareClick(index)}
            disabled={isFinished || !isMyTurn || Boolean(gameData.board[index])}
          >
            {getSquareContent(index)}
          </button>
        ))}
      </div>

      {/* Rematch Button */}
      {isFinished && (
        <div className="text-center">
          <button
            onClick={handleRematch}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors"
          >
            Play Again
          </button>
        </div>
      )}

      {/* Debug Info */}
      {showDebugInfo && matchState && (
        <div className="text-xs text-gray-500 border-t pt-2 mt-4 font-mono">
          <div className="space-y-1">
            <div>Seat: {mySeat}</div>
            <div>Turn: {matchState.currentTurn}</div>
            <div>Version: {matchState.version}</div>
            <div>Finished: {isFinished ? 'true' : 'false'}</div>
            <div>Match: {matchState.id?.split('_').pop()}</div>
            <div>Winner: {gameData.winner || 'none'}</div>
          </div>
        </div>
      )}
    </div>
  )
}