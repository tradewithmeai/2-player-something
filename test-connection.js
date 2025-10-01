// Test script to verify the multi-game system works
const { io } = require('socket.io-client');

console.log('Testing 2-player multi-game system...');

// Connect to the server
const socket = io('http://localhost:8890/game', {
  transports: ['websocket', 'polling']
});

socket.on('connect', () => {
  console.log('✅ Connected to server');

  // Test room creation
  socket.emit('createRoom', { isPublic: false }, (response) => {
    if (response.success) {
      console.log('✅ Room created:', response.room.code);
      const roomCode = response.room.code;

      // Join the room
      socket.emit('joinRoom', { code: roomCode }, (joinResponse) => {
        if (joinResponse.success) {
          console.log('✅ Joined room successfully');

          // Start match to test game engine
          socket.emit('startMatch', (matchResponse) => {
            if (matchResponse.success) {
              console.log('✅ Match started successfully');
              console.log('Game Type should be gameofstrife');

              // Check match state
              if (matchResponse.matchState) {
                console.log('Match State received:');
                console.log('- Game Type:', matchResponse.matchState.gameType || 'NOT SET');
                console.log('- Board Length:', matchResponse.matchState.board?.length || 0);
                console.log('- Current Turn:', matchResponse.matchState.currentTurn);

                if (matchResponse.matchState.gameType === 'gameofstrife') {
                  console.log('🎉 SUCCESS: Game type correctly set to gameofstrife!');
                } else {
                  console.log('❌ FAIL: Game type is not gameofstrife');
                }
              }
            } else {
              console.log('❌ Failed to start match:', matchResponse.error);
            }

            socket.disconnect();
            process.exit(0);
          });
        } else {
          console.log('❌ Failed to join room:', joinResponse.error);
          socket.disconnect();
          process.exit(1);
        }
      });
    } else {
      console.log('❌ Failed to create room:', response.error);
      socket.disconnect();
      process.exit(1);
    }
  });
});

socket.on('connect_error', (error) => {
  console.log('❌ Connection failed:', error.message);
  process.exit(1);
});

socket.on('disconnect', () => {
  console.log('Disconnected from server');
});

// Timeout after 10 seconds
setTimeout(() => {
  console.log('❌ Test timeout');
  socket.disconnect();
  process.exit(1);
}, 10000);