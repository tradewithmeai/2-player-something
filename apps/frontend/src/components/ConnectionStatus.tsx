import { useSocketStore } from '../stores/socketStore'

export const ConnectionStatus = () => {
  const { 
    isConnected, 
    connectionStatus, 
    connect, 
    disconnect, 
    sendPing, 
    lastPong, 
    serverTime 
  } = useSocketStore()

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected': return 'bg-green-500'
      case 'connecting': return 'bg-yellow-500'
      case 'error': return 'bg-red-500'
      default: return 'bg-gray-500'
    }
  }

  const getStatusText = () => {
    switch (connectionStatus) {
      case 'connected': return 'Connected'
      case 'connecting': return 'Connecting...'
      case 'error': return 'Connection Error'
      default: return 'Disconnected'
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-6 max-w-md">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-gray-800">Socket.IO Status</h2>
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${getStatusColor()}`}></div>
          <span className="text-sm font-medium text-gray-600">
            {getStatusText()}
          </span>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex gap-2">
          <button
            onClick={connect}
            disabled={isConnected}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            Connect
          </button>
          <button
            onClick={disconnect}
            disabled={!isConnected}
            className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            Disconnect
          </button>
          <button
            onClick={sendPing}
            disabled={!isConnected}
            className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            Ping Server
          </button>
        </div>

        {lastPong && (
          <div className="bg-gray-50 p-3 rounded text-sm">
            <p className="text-gray-600">
              <strong>Last Pong:</strong> {new Date(lastPong).toLocaleTimeString()}
            </p>
            {serverTime && (
              <p className="text-gray-600 mt-1">
                <strong>Server Time:</strong> {new Date(serverTime).toLocaleTimeString()}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}