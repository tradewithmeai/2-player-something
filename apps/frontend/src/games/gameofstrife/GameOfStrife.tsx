// Main Game of Strife component adapted for 2-player system

import React, { useMemo, useCallback } from 'react'
import { GameProps } from '../../components/GameRegistry'
import { GameOfStrifeBoard } from './GameBoard'
import { GameOfStrifeHUD } from './GameHUD'
import {
  GameStage,
  DEFAULT_GAME_CONFIG,
  getBoardFromFlat,
  createEmptyBoard
} from './types'
import { useSocketStore } from '../../stores/socketStore'

export const GameOfStrife: React.FC<GameProps> = ({
  matchState,
  mySeat,
  isMyTurn,
  onAction,
  onRematch
}) => {
  // Calculate isFinished from match state
  const isFinished = Boolean(matchState?.winner)

  // Socket store for additional state
  const {
    currentWindowId,
    windowDeadline,
    pendingClaims,
    pendingSimulClaims
  } = useSocketStore()

  // Convert match state to Game of Strife format
  const gameData = useMemo(() => {
    if (!matchState) {
      return {
        board: createEmptyBoard(DEFAULT_GAME_CONFIG.boardSize),
        stage: 'waiting' as GameStage,
        generation: 0,
        playerTokens: {
          player0: DEFAULT_GAME_CONFIG.tokensPerPlayer,
          player1: DEFAULT_GAME_CONFIG.tokensPerPlayer
        },
        boardSize: DEFAULT_GAME_CONFIG.boardSize
      }
    }

    // Determine board size from the flat board length
    const boardSize = Math.sqrt(matchState.board.length)

    // Convert flat board to 2D Cell array
    const board = getBoardFromFlat(matchState.board, boardSize)

    // Determine game stage based on match state
    let stage: GameStage = 'placement'
    if (isFinished) {
      stage = 'finished'
    } else if (matchState.currentTurn === null) {
      // When no current turn, likely in simulation phase
      stage = 'simulation'
    }

    // Extract Game of Strife metadata if available
    const metadata = (matchState as any).metadata || {}

    return {
      board,
      stage,
      generation: metadata.generation || 0,
      playerTokens: metadata.playerTokens || {
        player0: DEFAULT_GAME_CONFIG.tokensPerPlayer,
        player1: DEFAULT_GAME_CONFIG.tokensPerPlayer
      },
      boardSize
    }
  }, [matchState, isFinished])

  // Handle game actions from the board
  const handleGameAction = useCallback((action: any) => {
    if (!matchState || !mySeat) return

    switch (action.type) {
      case 'PLACE_TOKEN':
        // Convert to socket claim square action - use position directly
        onAction(action.payload.position)
        break

      default:
        // For other actions, try to extract squareId/position
        if (action.payload?.squareId !== undefined) {
          onAction(action.payload.squareId)
        } else if (action.payload?.position !== undefined) {
          onAction(action.payload.position)
        }
    }
  }, [matchState, mySeat, onAction])

  // Handle rematch
  const handleRematch = useCallback(() => {
    onRematch()
  }, [onRematch])

  // Set default values for missing props
  const className = ''
  const showDebugInfo = false

  if (!matchState) {
    return (
      <div className={`flex items-center justify-center p-8 ${className}`}>
        <div className="text-gray-400">No active match</div>
      </div>
    )
  }

  const isPlacementStage = gameData.stage === 'placement'

  return (
    <div className={`flex flex-col space-y-4 ${className}`}>
      {/* Game HUD */}
      <GameOfStrifeHUD
        board={gameData.board}
        stage={gameData.stage}
        generation={gameData.generation}
        playerTokens={gameData.playerTokens}
        matchState={matchState}
        mySeat={mySeat}
        isMyTurn={isMyTurn}
        isFinished={isFinished}
        onGameAction={handleGameAction}
        onRematch={handleRematch}
        currentWindowId={currentWindowId || undefined}
        windowDeadline={windowDeadline || undefined}
        showDebugInfo={showDebugInfo}
      />

      {/* Game Board */}
      <div className="flex justify-center">
        <GameOfStrifeBoard
          board={gameData.board}
          stage={gameData.stage}
          boardSize={gameData.boardSize}
          isPlacementStage={isPlacementStage}
          matchState={matchState}
          mySeat={mySeat}
          isMyTurn={isMyTurn}
          isFinished={isFinished}
          onGameAction={handleGameAction}
          onRematch={handleRematch}
          className="max-w-2xl"
          showDebugInfo={showDebugInfo}
        />
      </div>

      {/* Additional Game Info */}
      {gameData.stage === 'simulation' && (
        <div className="text-center">
          <div className="bg-purple-900 text-purple-100 px-4 py-2 rounded-lg inline-block">
            🧬 Conway's Game of Life simulation in progress...
            <br />
            <span className="text-sm">Generation {gameData.generation}</span>
          </div>
        </div>
      )}

      {/* Conway's Game of Life Rules Info */}
      {gameData.stage === 'placement' && (
        <div className="text-center text-sm text-gray-500 max-w-md mx-auto">
          <div className="bg-gray-800 p-3 rounded-lg">
            <div className="font-semibold mb-2">Conway's Game of Life Rules:</div>
            <div className="text-xs space-y-1">
              <div>• Live cells with 2-3 neighbors survive</div>
              <div>• Dead cells with exactly 3 neighbors become alive</div>
              <div>• All other cells die or stay dead</div>
              <div className="pt-2 text-yellow-400">
                Place your tokens strategically!
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pending Claims Indicator */}
      {(pendingClaims.size > 0 || pendingSimulClaims.size > 0) && (
        <div className="text-center">
          <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-3 py-1 rounded-lg text-sm inline-block">
            ⏳ Processing token placement...
          </div>
        </div>
      )}
    </div>
  )
}