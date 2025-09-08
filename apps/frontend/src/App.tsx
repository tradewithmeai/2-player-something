import { useEffect } from 'react'
import { ConnectionStatus } from './components/ConnectionStatus'
import { useSocketStore } from './stores/socketStore'

function App() {
  const { connect } = useSocketStore()

  useEffect(() => {
    connect()
  }, [connect])

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="container mx-auto max-w-4xl">
        <header className="text-center mb-8 pt-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">
            2-Player Game
          </h1>
          <p className="text-gray-600">
            Real-time multiplayer gaming with Socket.IO
          </p>
        </header>

        <main className="flex justify-center">
          <ConnectionStatus />
        </main>

        <footer className="text-center mt-12 text-gray-500 text-sm">
          <p>Built with React, Socket.IO, Fastify, and Tailwind CSS</p>
        </footer>
      </div>
    </div>
  )
}

export default App
