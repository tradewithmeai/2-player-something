// Simple static game registry for multi-game platform
import React from 'react'
import { TicTacToeBoard } from './TicTacToeBoard'
import { GameOfStrife } from '../games/gameofstrife/GameOfStrife'

// Standard props interface for all game components
export interface GameProps {
  matchState: any // Match state from server
  mySeat: 'P1' | 'P2'
  isMyTurn: boolean
  onAction: (squareId: number) => void // Use existing socket methods
  onRematch: () => void
}

// Game type definitions
export type GameType = 'tictactoe' | 'gameofstrife' | 'backgammon'

// Simple static registry - direct imports, no complex loading
export const GAMES: Record<GameType, React.ComponentType<GameProps> | null> = {
  tictactoe: TicTacToeBoard as any, // Will adapt this component
  gameofstrife: GameOfStrife as any, // Will adapt this component
  backgammon: null // Not implemented yet
}

// Game information for UI
export const GAME_INFO: Record<GameType, { name: string; description: string }> = {
  tictactoe: {
    name: 'Tic-Tac-Toe',
    description: 'Classic 3x3 grid game'
  },
  gameofstrife: {
    name: 'Game of Strife',
    description: "Conway's Game of Life battle"
  },
  backgammon: {
    name: 'Backgammon',
    description: 'Ancient strategy game'
  }
}