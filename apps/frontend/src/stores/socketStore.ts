import { create } from 'zustand'
import { io, Socket } from 'socket.io-client'

interface SocketState {
  socket: Socket | null
  isConnected: boolean
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'error'
  lastPong: string | null
  serverTime: string | null
  connect: () => void
  disconnect: () => void
  sendPing: () => void
}

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001'

export const useSocketStore = create<SocketState>((set, get) => ({
  socket: null,
  isConnected: false,
  connectionStatus: 'disconnected',
  lastPong: null,
  serverTime: null,

  connect: () => {
    const { socket: existingSocket } = get()
    if (existingSocket?.connected) return

    set({ connectionStatus: 'connecting' })

    const socket = io(`${SERVER_URL}/game`, {
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
    })

    socket.on('connect', () => {
      console.log('Connected to server:', socket.id)
      set({
        isConnected: true,
        connectionStatus: 'connected',
        socket,
      })
    })

    socket.on('disconnect', reason => {
      console.log('Disconnected from server:', reason)
      set({
        isConnected: false,
        connectionStatus: 'disconnected',
      })
    })

    socket.on('connect_error', error => {
      console.error('Connection error:', error)
      set({
        isConnected: false,
        connectionStatus: 'error',
      })
    })

    socket.on('welcome', data => {
      console.log('Welcome message:', data)
    })

    socket.on('pong', data => {
      console.log('Received pong:', data)
      set({
        lastPong: new Date().toISOString(),
        serverTime: data.serverTime,
      })
    })

    set({ socket })
  },

  disconnect: () => {
    const { socket } = get()
    if (socket) {
      socket.disconnect()
      set({
        socket: null,
        isConnected: false,
        connectionStatus: 'disconnected',
      })
    }
  },

  sendPing: () => {
    const { socket, isConnected } = get()
    if (socket && isConnected) {
      const pingData = {
        clientTime: new Date().toISOString(),
        message: 'ping from client',
      }
      socket.emit('ping', pingData)
      console.log('Sent ping:', pingData)
    }
  },
}))
