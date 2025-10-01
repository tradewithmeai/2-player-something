// Game of Strife HUD component adapted for 2-player system

import React from 'react'
import { GameComponentProps } from '../../types/gameTypes'
import { GameStage, countLivingCells, Cell } from './types'

interface GameOfStrifeHUDProps extends GameComponentProps {
  board: Cell[][]
  stage: GameStage
  generation: number
  playerTokens: {
    player0: number
    player1: number
  }
  currentWindowId?: number
  windowDeadline?: number
}

export const GameOfStrifeHUD: React.FC<GameOfStrifeHUDProps> = ({
  board,
  stage,
  generation,
  playerTokens,
  mySeat,
  isMyTurn,
  isFinished,
  matchState,
  currentWindowId,
  windowDeadline,
  onRematch,
  showDebugInfo = false
}) => {
  const myPlayerIndex = mySeat === 'P1' ? 0 : 1
  const opponentPlayerIndex = mySeat === 'P1' ? 1 : 0

  const myTokens = mySeat === 'P1' ? playerTokens.player0 : playerTokens.player1
  const opponentTokens = mySeat === 'P1' ? playerTokens.player1 : playerTokens.player0

  const myLivingCells = countLivingCells(board, myPlayerIndex)
  const opponentLivingCells = countLivingCells(board, opponentPlayerIndex)
  const totalLivingCells = countLivingCells(board)

  const getStageDisplay = () => {
    switch (stage) {
      case 'placement':
        return 'Token Placement'
      case 'simulation':
        return 'Conway Simulation'
      case 'paused':
        return 'Paused'
      case 'finished':
        return 'Game Complete'
      case 'waiting':
        return 'Waiting for Players'
      default:
        return stage
    }
  }

  const getPlayerSymbol = (seat: 'P1' | 'P2') => {
    return seat === 'P1' ? '●' : '●'
  }

  const getPlayerColor = (seat: 'P1' | 'P2') => {
    return seat === 'P1' ? 'text-blue-500' : 'text-green-500'
  }

  const getTurnStatus = () => {
    if (isFinished) {
      if (matchState?.winner === 'draw') {
        return <div className="text-xl font-bold text-yellow-600">Draw</div>
      } else if (matchState?.winner) {
        return (
          <div className="text-xl font-bold text-green-600">
            {matchState.winner === mySeat ? 'You Win!' : 'You Lose'}
          </div>
        )
      } else {
        return <div className="text-xl font-bold text-gray-600">Game Over</div>
      }
    }

    if (stage === 'simulation') {
      return (
        <div className="text-lg font-semibold text-purple-600">
          Simulation Running...
        </div>
      )
    }

    if (stage === 'placement') {
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

    return <div className="text-lg text-gray-600">{getStageDisplay()}</div>
  }

  return (
    <div className="space-y-4 p-4 bg-gray-800 rounded-lg text-white">
      {/* Game Status */}
      <div className="text-center">
        {getTurnStatus()}
        {stage === 'placement' && (
          <div className="text-sm text-gray-400 mt-1">
            Stage: {getStageDisplay()}
          </div>
        )}
      </div>

      {/* Player Information */}
      <div className="grid grid-cols-2 gap-4">
        {/* My Stats */}
        <div className={`text-center p-3 rounded ${mySeat === 'P1' ? 'bg-blue-900' : 'bg-green-900'}`}>
          <div className={`text-lg font-semibold ${getPlayerColor(mySeat!)}`}>
            <span className={getPlayerColor(mySeat!)}>{getPlayerSymbol(mySeat!)}</span> You ({mySeat})
          </div>
          <div className="text-sm text-gray-300">Tokens: {myTokens}</div>
          <div className="text-sm text-gray-300">Living Cells: {myLivingCells}</div>
        </div>

        {/* Opponent Stats */}
        <div className={`text-center p-3 rounded ${mySeat === 'P1' ? 'bg-green-900' : 'bg-blue-900'}`}>
          <div className={`text-lg font-semibold ${getPlayerColor(mySeat === 'P1' ? 'P2' : 'P1')}`}>
            <span className={getPlayerColor(mySeat === 'P1' ? 'P2' : 'P1')}>
              {getPlayerSymbol(mySeat === 'P1' ? 'P2' : 'P1')}
            </span> Opponent ({mySeat === 'P1' ? 'P2' : 'P1'})
          </div>
          <div className="text-sm text-gray-300">Tokens: {opponentTokens}</div>
          <div className="text-sm text-gray-300">Living Cells: {opponentLivingCells}</div>
        </div>
      </div>

      {/* Conway Simulation Stats */}
      {(stage === 'simulation' || stage === 'finished') && (
        <div className="text-center p-3 bg-purple-900 rounded">
          <div className="text-lg font-semibold text-purple-300">Conway's Game of Life</div>
          <div className="text-sm text-gray-300">Generation: {generation}</div>
          <div className="text-sm text-gray-300">Total Living Cells: {totalLivingCells}</div>
        </div>
      )}

      {/* Simultaneous Mode Info */}
      {matchState?.mode === 'simul' && !isFinished && (
        <div className="bg-purple-100 border border-purple-400 text-purple-700 px-3 py-1 rounded-lg text-xs text-center">
          🔀 Simultaneous mode - Both players can place tokens
          {currentWindowId && (
            <div className="text-xs mt-1">
              Window #{currentWindowId}
              {windowDeadline && (
                <span className="ml-2">
                  {Math.max(0, Math.ceil((windowDeadline - Date.now()) / 1000))}s
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Game Instructions */}
      {stage === 'placement' && !isFinished && (
        <div className="text-center text-sm text-gray-400">
          {isMyTurn ? (
            <div>
              Click or drag to place your tokens on the board.
              <br />
              {myTokens > 0 ? `${myTokens} tokens remaining` : 'All tokens placed!'}
            </div>
          ) : (
            <div>Waiting for opponent to place tokens...</div>
          )}
        </div>
      )}

      {stage === 'simulation' && (
        <div className="text-center text-sm text-gray-400">
          Conway's Game of Life simulation is running.
          <br />
          Cells evolve based on their neighbors!
        </div>
      )}

      {/* Rematch Button */}
      {isFinished && (
        <div className="text-center">
          <button
            onClick={onRematch}
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
            <div>Stage: {stage}</div>
            <div>Generation: {generation}</div>
            <div>Finished: {isFinished ? 'true' : 'false'}</div>
            <div>Match: {matchState.id?.split('_').pop()}</div>
            <div>Board Size: {board.length}x{board[0]?.length || 0}</div>
          </div>
        </div>
      )}
    </div>
  )
}