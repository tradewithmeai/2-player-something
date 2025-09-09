import { useSocketStore, getMySeat, getSymbol } from '../stores/socketStore'

interface TicTacToeBoardProps {
  className?: string
}

export function TicTacToeBoard({ className = '' }: TicTacToeBoardProps) {
  const {
    matchState,
    pendingClaims,
    pendingSimulClaims,
    mySeat,
    rematchPending,
    rematchRequesterSeat,
    isFinished,
    matchFinishedNotice,
    matchMode,
    currentWindowId,
    windowDeadline,
    claimSquare,
    requestRematch,
    acceptRematch
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

    if (matchMode === 'simul') {
      // Simul mode: check if we have a pending claim for this square
      const myPendingClaim = mySeat ? pendingSimulClaims.get(mySeat) : null
      if (myPendingClaim && myPendingClaim.squareId === squareIndex) {
        return {
          type: 'pending' as const,
          player: mySeat,
          isPending: true
        }
      }
    } else {
      // Turn mode: check legacy pending claims
      const hasPendingClaim = Array.from(pendingClaims.values()).some(claim => claim.squareId === squareIndex)
      if (hasPendingClaim) {
        return {
          type: 'pending' as const,
          player: mySeat,
          isPending: true
        }
      }
    }

    return {
      type: 'empty' as const,
      player: null,
      isPending: false
    }
  }

  const handleSquareClick = (squareIndex: number) => {
    if (isGameFinished) return
    
    // Mode-specific turn checking
    if (matchMode === 'turn' && !isMyTurn) return
    
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
    
    if (isGameFinished) {
      return `${baseClasses} cursor-not-allowed bg-gray-50`
    }

    // Mode-specific turn checking
    if (matchMode === 'turn' && !isMyTurn) {
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
                // Show different UI based on who requested rematch
                rematchRequesterSeat === mySeat ? (
                  <div className="bg-yellow-500 text-white px-6 py-2 rounded-lg font-medium">
                    Waiting for opponent...
                  </div>
                ) : (
                  <button
                    onClick={acceptRematch}
                    className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg font-medium transition-colors"
                  >
                    Accept Rematch
                  </button>
                )
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
            <div className="text-sm text-gray-600">
              You are: {getSymbol(getMySeat(useSocketStore.getState()))} ({getMySeat(useSocketStore.getState()) ?? '—'})
            </div>
            {matchMode === 'simul' ? (
              <div className="text-lg font-semibold">
                Simultaneous Mode
                {currentWindowId && (
                  <div className="text-sm text-gray-600">
                    Window #{currentWindowId}
                    {windowDeadline && (
                      <span className="ml-2 text-xs">
                        {Math.max(0, Math.ceil((windowDeadline - Date.now()) / 1000))}s
                      </span>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-lg font-semibold">
                Turn: {matchState.currentTurn}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Simul mode badge */}
      {matchMode === 'simul' && !isGameFinished && (
        <div className="bg-purple-100 border border-purple-400 text-purple-700 px-3 py-1 rounded-lg text-xs text-center">
          🔀 Simultaneous mode - Both players can select
        </div>
      )}

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
            <span>seat: {mySeat}</span>
            <span>turn: {matchState.currentTurn}</span>
            <span>version: {matchState.version}</span>
            <span>finished: {isFinished ? 'true' : 'false'}</span>
            <span>match: {matchState.id.split('_').pop()}</span>
          </div>
        </div>
      )}
    </div>
  )
}