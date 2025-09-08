import { useSocketStore } from '../stores/socketStore'

interface TicTacToeBoardProps {
  className?: string
}

export function TicTacToeBoard({ className = '' }: TicTacToeBoardProps) {
  const {
    matchState,
    pendingClaims,
    mySeat,
    rematchPending,
    isFinished,
    matchFinishedNotice,
    claimSquare,
    requestRematch
  } = useSocketStore()

  if (!matchState) {
    return (
      <div className={`flex items-center justify-center p-8 ${className}`}>
        <div className="text-gray-400">No active match</div>
      </div>
    )
  }

  const isMyTurn = matchState.currentTurn === mySeat
  const isGameFinished = isFinished

  const getSquareState = (squareIndex: number) => {
    // Check if square is claimed
    if (matchState.board[squareIndex]) {
      return {
        type: 'claimed' as const,
        player: matchState.board[squareIndex],
        isPending: false
      }
    }

    // Check if square has pending claim
    const hasPendingClaim = Array.from(pendingClaims.values()).some(claim => claim.squareId === squareIndex)
    if (hasPendingClaim) {
      return {
        type: 'pending' as const,
        player: mySeat,
        isPending: true
      }
    }

    return {
      type: 'empty' as const,
      player: null,
      isPending: false
    }
  }

  const handleSquareClick = (squareIndex: number) => {
    if (isGameFinished || !isMyTurn) return
    
    const squareState = getSquareState(squareIndex)
    if (squareState.type !== 'empty') return

    claimSquare(squareIndex)
  }

  const getSquareContent = (squareIndex: number) => {
    const squareState = getSquareState(squareIndex)
    
    switch (squareState.type) {
      case 'claimed': {
        const isWinningSquare = matchState.winningLine?.includes(squareIndex)
        const symbol = squareState.player === 'P1' ? 'X' : 'O'
        return (
          <div className={`text-4xl font-bold ${isWinningSquare ? 'text-green-500' : 'text-blue-600'}`}>
            {symbol}
          </div>
        )
      }
      
      case 'pending':
        return (
          <div className="w-3 h-3 bg-yellow-500 rounded-full animate-pulse"></div>
        )
      
      case 'empty':
      default:
        return null
    }
  }

  const getSquareClasses = (squareIndex: number) => {
    const baseClasses = 'w-20 h-20 border-2 border-gray-300 flex items-center justify-center cursor-pointer transition-all duration-200'
    
    if (isGameFinished || !isMyTurn) {
      return `${baseClasses} cursor-not-allowed bg-gray-50`
    }

    const squareState = getSquareState(squareIndex)
    if (squareState.type !== 'empty') {
      return `${baseClasses} cursor-not-allowed bg-gray-100`
    }

    return `${baseClasses} hover:bg-blue-50 bg-white`
  }

  return (
    <div className={`flex flex-col items-center space-y-6 ${className}`}>
      {/* Game status */}
      <div className="text-center">
        {isGameFinished ? (
          <div className="space-y-4">
            <div className="space-y-2">
              {matchState.winner === 'draw' ? (
                <div className="text-xl font-bold text-yellow-600">Draw</div>
              ) : matchState.winner ? (
                <div className="text-xl font-bold text-green-600">
                  {matchState.winner === mySeat ? 'You Win' : 'You Lose'}
                </div>
              ) : (
                <div className="text-xl font-bold text-gray-600">Game Over</div>
              )}
            </div>
            
            {/* Rematch button */}
            <div className="flex justify-center">
              {rematchPending ? (
                <div className="bg-yellow-500 text-white px-6 py-2 rounded-lg font-medium">
                  Waiting for opponent...
                </div>
              ) : (
                <button
                  onClick={requestRematch}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors"
                >
                  Rematch
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-lg font-semibold">
              {isMyTurn ? 'Your Turn' : 'Opponent\'s Turn'}
            </div>
            <div className="text-sm text-gray-600">
              You are: {mySeat === 'P1' ? 'X' : 'O'} ({mySeat})
            </div>
          </div>
        )}
      </div>

      {/* Match finished notice */}
      {matchFinishedNotice && (
        <div className="bg-orange-100 border border-orange-400 text-orange-700 px-4 py-2 rounded-lg text-sm text-center">
          {matchFinishedNotice}
        </div>
      )}

      {/* 3x3 Grid */}
      <div className="grid grid-cols-3 gap-1 border-4 border-gray-400 p-2 bg-gray-200">
        {Array.from({ length: 9 }, (_, index) => (
          <button
            key={index}
            className={getSquareClasses(index)}
            onClick={() => handleSquareClick(index)}
            disabled={isGameFinished || !isMyTurn || getSquareState(index).type !== 'empty'}
          >
            {getSquareContent(index)}
          </button>
        ))}
      </div>

      {/* Debug info in development */}
      {import.meta.env.DEV && (
        <div className="text-xs text-gray-500 max-w-md border-t pt-2 mt-4">
          <div className="font-mono space-x-4">
            <span>Seat: <strong>{mySeat}</strong></span>
            <span>Turn: <strong>{matchState.currentTurn}</strong></span>
            <span>v: <strong>{matchState.version}</strong></span>
          </div>
          <div className="text-xs opacity-60 mt-1">
            <span>Match: {matchState.id}</span>
            <span className="ml-2">Pending: {pendingClaims.size}</span>
            <span className="ml-2">Status: {matchState.status}</span>
          </div>
        </div>
      )}
    </div>
  )
}