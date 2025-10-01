// Game of Strife GameBoard adapted for 2-player system

import React, { useCallback, useState, useRef, useEffect } from 'react'
import { Cell, MEMORY_FLAGS, GameStage } from './types'
import { GameComponentProps } from '../../types/gameTypes'

interface GameOfStrifeBoardProps extends GameComponentProps {
  board: Cell[][]
  stage: GameStage
  boardSize: number
  isPlacementStage: boolean
  selectedCell?: { row: number; col: number } | null
  fullscreen?: boolean
}

export const GameOfStrifeBoard: React.FC<GameOfStrifeBoardProps> = ({
  board,
  boardSize,
  isPlacementStage,
  isMyTurn,
  isFinished,
  onGameAction,
  selectedCell,
  fullscreen = false,
  className = ''
}) => {
  const [isDragging, setIsDragging] = useState(false)
  const [dragStarted, setDragStarted] = useState(false)
  const boardRef = useRef<HTMLDivElement>(null)
  const lastPlacedCell = useRef<string | null>(null)

  // Get cell coordinates from mouse/touch position with expanded hit areas
  const getCellFromPosition = useCallback((clientX: number, clientY: number): { row: number; col: number } | null => {
    if (!boardRef.current) return null

    const rect = boardRef.current.getBoundingClientRect()
    const relativeX = clientX - rect.left
    const relativeY = clientY - rect.top

    // Calculate cell size
    const cellSize = Math.min(rect.width, rect.height) / boardSize

    // Add tolerance for easier targeting (expand hit area by 25%)
    const tolerance = cellSize * 0.125 // 12.5% on each side = 25% total expansion

    const col = Math.floor((relativeX + tolerance) / cellSize)
    const row = Math.floor((relativeY + tolerance) / cellSize)

    // Check bounds with tolerance
    if (row >= 0 && row < boardSize && col >= 0 && col < boardSize) {
      // Additional check: ensure we're not too far from the actual cell center
      const cellCenterX = (col + 0.5) * cellSize
      const cellCenterY = (row + 0.5) * cellSize
      const distanceX = Math.abs(relativeX - cellCenterX)
      const distanceY = Math.abs(relativeY - cellCenterY)

      // Allow placement if within expanded area (cellSize/2 + tolerance)
      if (distanceX <= cellSize * 0.75 && distanceY <= cellSize * 0.75) {
        return { row, col }
      }
    }

    return null
  }, [boardSize])

  // Handle token placement during drag
  const handlePlacement = useCallback((row: number, col: number) => {
    if (!isPlacementStage || !isMyTurn || isFinished) return

    const cellKey = `${row}-${col}`
    // Avoid placing multiple tokens on the same cell during one drag
    if (lastPlacedCell.current === cellKey) return

    // Check if cell is already occupied
    if (board[row] && board[row][col] && board[row][col].player !== null) return

    lastPlacedCell.current = cellKey

    // Convert to flat board position for socket system
    const position = row * boardSize + col

    onGameAction({
      type: 'PLACE_TOKEN',
      payload: { position, row, col },
      timestamp: Date.now()
    })
  }, [isPlacementStage, isMyTurn, isFinished, board, boardSize, onGameAction])

  // Mouse event handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!isPlacementStage || !isMyTurn) return
    e.preventDefault()
    setIsDragging(true)
    setDragStarted(true)
    lastPlacedCell.current = null

    const cell = getCellFromPosition(e.clientX, e.clientY)
    if (cell) {
      handlePlacement(cell.row, cell.col)
    }
  }, [isPlacementStage, isMyTurn, getCellFromPosition, handlePlacement])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || !isPlacementStage || !isMyTurn) return
    e.preventDefault()

    const cell = getCellFromPosition(e.clientX, e.clientY)
    if (cell) {
      handlePlacement(cell.row, cell.col)
    }
  }, [isDragging, isPlacementStage, isMyTurn, getCellFromPosition, handlePlacement])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
    lastPlacedCell.current = null
  }, [])

  // Touch event handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isPlacementStage || !isMyTurn) return
    e.preventDefault()
    setIsDragging(true)
    setDragStarted(true)
    lastPlacedCell.current = null

    const touch = e.touches[0]
    const cell = getCellFromPosition(touch.clientX, touch.clientY)
    if (cell) {
      handlePlacement(cell.row, cell.col)
    }
  }, [isPlacementStage, isMyTurn, getCellFromPosition, handlePlacement])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging || !isPlacementStage || !isMyTurn) return
    e.preventDefault()

    const touch = e.touches[0]
    const cell = getCellFromPosition(touch.clientX, touch.clientY)
    if (cell) {
      handlePlacement(cell.row, cell.col)
    }
  }, [isDragging, isPlacementStage, isMyTurn, getCellFromPosition, handlePlacement])

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false)
    lastPlacedCell.current = null
  }, [])

  // Global mouse events for when dragging outside the board
  useEffect(() => {
    if (!isDragging) return

    const handleGlobalMouseMove = (e: MouseEvent) => {
      const cell = getCellFromPosition(e.clientX, e.clientY)
      if (cell) {
        handlePlacement(cell.row, cell.col)
      }
    }

    const handleGlobalMouseUp = () => {
      setIsDragging(false)
      lastPlacedCell.current = null
    }

    document.addEventListener('mousemove', handleGlobalMouseMove)
    document.addEventListener('mouseup', handleGlobalMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove)
      document.removeEventListener('mouseup', handleGlobalMouseUp)
    }
  }, [isDragging, getCellFromPosition, handlePlacement])

  const getSuperpowerVisualClass = (superpowerType: number, memory: number) => {
    const classes = []

    switch (superpowerType) {
      case 1: // Tank
        classes.push('superpower-tank')
        break
      case 2: // Spreader
        classes.push('superpower-spreader')
        break
      case 3: // Survivor
        classes.push('superpower-survivor')
        break
      case 4: // Ghost
        classes.push('superpower-ghost')
        break
      case 5: // Replicator
        classes.push('superpower-replicator')
        break
      case 6: // Destroyer
        classes.push('superpower-destroyer')
        break
      case 7: // Hybrid
        classes.push('superpower-hybrid')
        break
    }

    // Add memory-based visual effects
    if (memory & MEMORY_FLAGS.IS_VETERAN) classes.push('cell-veteran')
    if (memory & MEMORY_FLAGS.HAS_CAUSED_BIRTH) classes.push('cell-spreader-glow')
    if (memory & MEMORY_FLAGS.BATTLE_SCARRED) classes.push('cell-battle-scarred')

    return classes.join(' ')
  }

  const getCellColor = (cell: Cell) => {
    let baseColor = ''

    // Only show alive cells - dead cells should be invisible (empty)
    if (cell.alive && cell.player === 0) {
      baseColor = 'bg-blue-500' // Player 1 (P1)
    } else if (cell.alive && cell.player === 1) {
      baseColor = 'bg-green-500' // Player 2 (P2)
    } else {
      // Dead cells or empty cells are invisible
      baseColor = 'bg-gray-800 border-gray-600'
    }

    const superpowerClass = cell.alive && cell.superpowerType > 0 ? getSuperpowerVisualClass(cell.superpowerType, cell.memory) : ''
    return `${baseColor} ${superpowerClass}`.trim()
  }

  const getCellHover = (cell: Cell) => {
    if (!isPlacementStage || !isMyTurn) return ''
    if (cell.player !== null) return ''
    return 'hover:bg-yellow-400 hover:opacity-50 cursor-pointer'
  }

  const handleCellClick = useCallback((rowIndex: number, colIndex: number) => {
    // Only handle click if it wasn't part of a drag operation
    if (dragStarted) {
      setDragStarted(false)
      return
    }

    if (isPlacementStage && isMyTurn && !isFinished) {
      handlePlacement(rowIndex, colIndex)
    }
  }, [isPlacementStage, isMyTurn, isFinished, dragStarted, handlePlacement])

  // Simplified fullscreen classes
  const containerClass = fullscreen
    ? "fullscreen-game-container"
    : `game-screen p-2 bg-gray-900 overflow-hidden ${className}`

  const boardClass = fullscreen
    ? "grid gap-0.5 border-2 border-blue-400 fullscreen-game-board"
    : "grid gap-0.5 mx-auto p-1 border-2 border-gray-500"

  const boardStyle = fullscreen
    ? {
        gridTemplateColumns: `repeat(${boardSize}, minmax(0, 1fr))`,
        touchAction: 'none' as const,
        userSelect: 'none' as const,
        WebkitTouchCallout: 'none' as const,
        WebkitUserSelect: 'none' as const
      }
    : {
        gridTemplateColumns: `repeat(${boardSize}, minmax(0, 1fr))`,
        width: 'min(95vw, min(95vh, 95vw))',
        height: 'min(95vw, min(95vh, 95vw))',
        touchAction: 'none' as const,
        userSelect: 'none' as const,
        WebkitTouchCallout: 'none' as const,
        WebkitUserSelect: 'none' as const
      }

  return (
    <div className={containerClass}>
      <div
        ref={boardRef}
        className={boardClass}
        style={boardStyle}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {board.map((row, rowIndex) =>
          row.map((cell, colIndex) => (
            <div
              key={`${rowIndex}-${colIndex}`}
              data-cell={`${rowIndex}-${colIndex}`}
              className={`
                aspect-square border border-gray-600 transition-all duration-100
                ${getCellColor(cell)}
                ${getCellHover(cell)}
                ${selectedCell?.row === rowIndex && selectedCell?.col === colIndex ? 'ring-2 ring-yellow-400' : ''}
              `}
              style={{ minWidth: '8px', minHeight: '8px' }}
              onClick={() => handleCellClick(rowIndex, colIndex)}
            />
          ))
        )}
      </div>
    </div>
  )
}