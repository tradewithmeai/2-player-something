import { useEffect } from 'react'
import { ConnectionStatus } from './components/ConnectionStatus'
import { HomeScreen } from './components/HomeScreen'
import { LobbyScreen } from './components/LobbyScreen'
import { MatchScreen } from './components/MatchScreen'
import { DevBanner } from './components/DevBanner'
import { DevFooter } from './components/DevFooter'
import { useSocketStore } from './stores/socketStore'

function App() {
  const { connect, currentRoom, currentMatch, matchState, connectionStatus } = useSocketStore()

  useEffect(() => {
    connect()
  }, [connect])

  // Show connection status for non-connected states
  if (connectionStatus !== 'connected') {
    return (
      <>
        <DevBanner />
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4" style={{ paddingTop: process.env.NODE_ENV === 'development' ? '40px' : '16px', paddingBottom: process.env.NODE_ENV === 'development' ? '40px' : '16px' }}>
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
        <DevFooter />
      </>
    )
  }

  // Navigation based on current state
  if (matchState || currentMatch) {
    return (
      <>
        <DevBanner />
        <div style={{ paddingTop: process.env.NODE_ENV === 'development' ? '40px' : '0', paddingBottom: process.env.NODE_ENV === 'development' ? '40px' : '0' }}>
          <MatchScreen match={currentMatch} />
        </div>
        <DevFooter />
      </>
    )
  }
  
  if (currentRoom) {
    return (
      <>
        <DevBanner />
        <div style={{ paddingTop: process.env.NODE_ENV === 'development' ? '40px' : '0', paddingBottom: process.env.NODE_ENV === 'development' ? '40px' : '0' }}>
          <LobbyScreen room={currentRoom} />
        </div>
        <DevFooter />
      </>
    )
  }

  return (
    <>
      <DevBanner />
      <div style={{ paddingTop: process.env.NODE_ENV === 'development' ? '40px' : '0', paddingBottom: process.env.NODE_ENV === 'development' ? '40px' : '0' }}>
        <HomeScreen />
      </div>
      <DevFooter />
    </>
  )
}

export default App
