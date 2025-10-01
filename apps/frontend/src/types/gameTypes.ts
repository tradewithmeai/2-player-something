// Universal game system types for multi-game platform

export type GameType = 'tictactoe' | 'gameofstrife' | 'backgammon'

export interface GameInfo {
  id: GameType
  name: string
  description: string
  minPlayers: number
  maxPlayers: number
  estimatedDuration: string // e.g., "5-10 minutes"
  complexity: 'beginner' | 'intermediate' | 'advanced'
  tags: string[]
}

// Universal game state interface that all games must implement
export interface BaseGameState {
  gameType: GameType
  phase: string // game-specific phases like 'placement', 'simulation', 'finished'
  currentPlayer: 'P1' | 'P2' | null
  winner: 'P1' | 'P2' | 'draw' | null
  isFinished: boolean
  version: number
  metadata?: Record<string, any> // game-specific additional data
}

// Interface that all game components must implement
export interface GameComponentProps {
  // Socket store state (common across all games)
  matchState: any
  mySeat: 'P1' | 'P2' | null
  isMyTurn: boolean
  isFinished: boolean

  // Game actions (standardized)
  onGameAction: (action: GameAction) => void
  onRematch: () => void

  // UI configuration
  className?: string
  showDebugInfo?: boolean
}

// Standardized game actions
export interface GameAction {
  type: string // game-specific action types
  payload: any // game-specific data
  playerId?: string
  timestamp?: number
}

// Socket integration bridge interface
export interface SocketGameBridge {
  // Convert between game state and socket state
  gameStateToSocketState: (gameState: any) => any
  socketStateToGameState: (socketState: any) => any

  // Handle game-specific socket events
  handleGameAction: (action: GameAction) => void

  // Game lifecycle hooks
  onGameStart?: () => void
  onGameEnd?: (result: { winner: string | null }) => void
  onPlayerJoin?: (playerId: string) => void
  onPlayerLeave?: (playerId: string) => void
}

// Game engine adapter interface (connects to backend)
export interface GameEngineAdapter {
  gameType: GameType

  // Validate if a game action is legal
  validateAction: (state: any, action: GameAction, player: 'P1' | 'P2') => boolean

  // Apply an action to the game state
  applyAction: (state: any, action: GameAction, player: 'P1' | 'P2') => any

  // Check if the game is finished and determine winner
  checkGameEnd: (state: any) => { finished: boolean; winner?: 'P1' | 'P2' | 'draw' }

  // Get valid actions for a player in current state
  getValidActions: (state: any, player: 'P1' | 'P2') => GameAction[]
}

// Game registry for dynamic game loading
export interface GameRegistration {
  info: GameInfo
  component: React.ComponentType<GameComponentProps>
  bridge: SocketGameBridge
  adapter: GameEngineAdapter
}

// Standardized game components that all games should implement
export interface GameComponents {
  GameBoard: React.ComponentType<GameComponentProps>
  GameHUD?: React.ComponentType<GameComponentProps> // Optional heads-up display
  GameSettings?: React.ComponentType<{ onSave: (settings: any) => void }> // Optional settings
  GameTutorial?: React.ComponentType<{ onComplete: () => void }> // Optional tutorial
}

// Game configuration and settings
export interface GameConfig {
  gameType: GameType
  boardSize?: number
  timeLimit?: number
  customRules?: Record<string, any>
  difficulty?: 'easy' | 'medium' | 'hard'
}

// Common game events for analytics and logging
export interface GameEvent {
  type: 'game_start' | 'game_end' | 'player_action' | 'game_error'
  gameType: GameType
  timestamp: number
  data: any
}

// Utility types for common patterns
export type PlayerAction<T = any> = {
  player: 'P1' | 'P2'
  action: T
  timestamp: number
}

export type GameResult = {
  winner: 'P1' | 'P2' | 'draw' | null
  score?: { P1: number; P2: number }
  duration: number // in milliseconds
  totalMoves: number
  endReason: 'normal' | 'timeout' | 'forfeit' | 'disconnect'
}

// Hook interface for game-specific logic
export interface GameHooks {
  useGameState: () => any
  useGameActions: () => Record<string, (...args: any[]) => void>
  useGameConfig: () => GameConfig
  useGameEvents: () => {
    emit: (event: GameEvent) => void
    subscribe: (callback: (event: GameEvent) => void) => () => void
  }
}