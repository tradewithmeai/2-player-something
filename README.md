# 2-Player Tic-Tac-Toe

A real-time multiplayer Tic-Tac-Toe game with two gameplay modes: traditional turn-based and simultaneous window-based play. Built with Socket.IO, React, and Fastify.

## 🚀 Quick Start

### Prerequisites

**Windows:**
- Node.js >= 18 ([Download from nodejs.org](https://nodejs.org/))
- pnpm >= 8 (install via `npm install -g pnpm`)
- Git

**macOS:**
- Node.js >= 18 (install via Homebrew: `brew install node`)
- pnpm >= 8 (install via `npm install -g pnpm`)  
- Git

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd 2-player-something

# Install dependencies
pnpm install
```

### Development

Start both server and frontend:

```bash
pnpm dev
```

This starts:
- **Game Server** on http://localhost:8890 (WebSocket + REST API)
- **Frontend** on http://localhost:5180 (React app)

Open two browser tabs/windows to play against yourself, or share the URL with a friend.

### Game Modes

**Turn Mode (Default):**
```bash
pnpm dev  # Uses turn-based gameplay
```

**Simultaneous Mode:**
```bash
pnpm dev:simul  # Uses window-based simultaneous gameplay
```

## 🧪 How to Run Tests

### Unit Tests
```bash
# Run all unit tests
pnpm test

# Run unit tests in watch mode  
pnpm test:watch

# Run backend-only tests (turn mode)
pnpm test:turn:be

# Run backend-only tests (simul mode)  
pnpm test:simul:be
```

### E2E Tests
```bash
# Install Playwright (first time only)
pnpm e2e:install

# Run turn mode E2E test
pnpm e2e:turn

# Run simultaneous mode E2E test
pnpm e2e:simul

# Run all E2E tests
pnpm e2e:all
```

**Note:** E2E tests automatically start dev servers, execute full gameplay scenarios with two browsers, verify win/lose states, and test rematch functionality.

## 🔧 Troubleshooting

### Port 8890 Conflicts
If you see `EADDRINUSE` errors:
```bash
# Windows
taskkill /PID <process-id> /F

# macOS/Linux
kill -9 <process-id>

# Find process using port
netstat -ano | findstr 8890  # Windows
lsof -i :8890                # macOS/Linux
```

### 'xhr poll error' Messages
- **Cause**: Frontend trying to connect before server is ready
- **Solution**: Wait 2-3 seconds after starting `pnpm dev`, or restart both services
- **Check**: Server logs should show "Server listening on port 8890"

### Handler Double-Attach Warnings
- **Cause**: Hot-reload in development attaching Socket.IO handlers multiple times
- **Solution**: Restart the server (`Ctrl+C` and `pnpm dev:server`)
- **Note**: This is development-only and doesn't affect production

### Rematch Expectations
- After a game ends, both players see "Rematch" or "Accept Rematch" buttons
- The **winner** initiates rematch, the **loser** accepts it
- After rematch, player roles flip (P1 becomes P2, P2 becomes P1)
- If rematch seems stuck, refresh both browsers

## 🎮 Game Modes & Configuration

### Environment Variables

**MATCH_MODE** - Controls server game mode:
```bash
MATCH_MODE=turn   # Turn-based gameplay (default)
MATCH_MODE=simul  # Simultaneous gameplay with windows
```

**VITE_MATCH_MODE** - Controls frontend UI mode:
```bash
VITE_MATCH_MODE=turn   # Shows turn indicator
VITE_MATCH_MODE=simul  # Shows simultaneous mode UI
```

**SIMUL_WINDOW_MS** - Window duration in simultaneous mode:
```bash
SIMUL_WINDOW_MS=500    # 500ms windows (default for dev)
SIMUL_WINDOW_MS=2000   # 2 second windows
```

**SIMUL_STARTER_ALTERNATION** - Whether to flip starting player on rematch:
```bash
SIMUL_STARTER_ALTERNATION=true   # P1/P2 roles flip on rematch
SIMUL_STARTER_ALTERNATION=false  # Same player always starts
```

### Mode Differences

**Turn Mode:**
- Classic Tic-Tac-Toe: P1 goes first, alternating turns
- UI shows "Turn: P1" or "Turn: P2"
- Only active player can click squares
- Rematch flips who goes first

**Simultaneous Mode:**
- Both players can select squares at the same time
- Actions grouped into time windows (500ms default)
- Conflicts resolved by priority rules
- UI shows "Simultaneous Mode" and window countdown
- Rematch flips starting priority

## 📊 Structured Logs Cheat-Sheet

### What to Look For

**Server Startup:**
```
✅ Server listening on port 8890
✅ CORS enabled for http://localhost:5180
✅ Match mode: turn | simul
```

**Client Connection:**
```
✅ Client connected: abc123
✅ Client abc123 joined game namespace
```

**Match Flow:**
```
✅ Quick match request from abc123
✅ Match started: match_abc123_def456
✅ P1: abc123 (X) vs P2: def456 (O)
```

**Game Actions (Turn Mode):**
```
✅ P1 claims square 0 → accepted
✅ Turn switched: P1 → P2
✅ Game finished: P1 wins [0,1,2]
```

**Game Actions (Simul Mode):**
```
✅ Window opened: #1 (500ms)
✅ P1 claims 0, P2 claims 4 → both accepted
✅ Window closed: #1 results processed
✅ Game finished: P1 wins [0,1,2]
```

**Error Patterns:**
```
❌ xhr poll error → Server connection issues
❌ EADDRINUSE     → Port 8890 already in use  
❌ Invalid claim  → Square already taken or out of turn
❌ Rate limit     → Too many requests from client
```

## 🏗️ Architecture

### Monorepo Structure
```
2-player-something/
├── apps/
│   ├── server/          # Fastify + Socket.IO backend
│   │   ├── src/
│   │   │   ├── services/    # Game logic, matchmaking
│   │   │   ├── tests/       # Unit & integration tests
│   │   │   └── types/       # TypeScript definitions
│   │   └── package.json
│   └── frontend/        # React + Vite frontend  
│       ├── src/
│       │   ├── components/  # UI components
│       │   ├── stores/      # Zustand state management
│       │   └── types/       # TypeScript definitions
│       └── package.json
├── e2e/                # Playwright end-to-end tests
├── playwright.config.ts
└── package.json        # Root workspace config
```

### Tech Stack

**Backend:**
- [Fastify](https://fastify.io/) - Web framework
- [Socket.IO](https://socket.io/) - Real-time WebSocket communication  
- [TypeScript](https://typescriptlang.org/) - Type safety
- [Vitest](https://vitest.dev/) - Unit testing

**Frontend:**
- [React](https://react.dev/) - UI framework
- [Vite](https://vitejs.dev/) - Build tool & dev server
- [Tailwind CSS](https://tailwindcss.com/) - Utility-first styling
- [Zustand](https://github.com/pmndrs/zustand) - Lightweight state management
- [Socket.IO Client](https://socket.io/docs/v4/client-api/) - Real-time client

**Testing:**
- [Vitest](https://vitest.dev/) - Unit & integration testing
- [Playwright](https://playwright.dev/) - End-to-end browser testing
- GitHub Actions - CI/CD pipeline

### Key Features

- ✅ **Real-time multiplayer** - Socket.IO with WebSocket transport
- ✅ **Two game modes** - Turn-based and simultaneous gameplay
- ✅ **Live connection status** - Connection indicator and reconnection
- ✅ **Match & rematch system** - Complete game loop with role flipping
- ✅ **Comprehensive testing** - Unit, integration, and E2E test coverage
- ✅ **Cross-platform** - Works on Windows, macOS, and Linux
- ✅ **TypeScript strict mode** - Full type safety across stack
- ✅ **PWA ready** - Progressive web app capabilities

## 🚀 Individual Commands

```bash
# Development
pnpm dev                # Start both server & frontend
pnpm dev:server         # Start only server (port 8890)
pnpm dev:frontend       # Start only frontend (port 5180)
pnpm dev:simul          # Start in simultaneous mode

# Building
pnpm build              # Build both apps for production
pnpm build:server       # Build only server
pnpm build:frontend     # Build only frontend

# Testing  
pnpm test               # Run all unit tests
pnpm test:watch         # Run tests in watch mode
pnpm test:simul         # Run simul-specific unit tests
pnpm e2e:all           # Run all E2E tests

# Code Quality
pnpm lint               # Lint all code
pnpm lint:fix           # Fix linting issues
pnpm format             # Format code with Prettier
pnpm type-check         # TypeScript type checking
pnpm check              # Run lint + typecheck + tests

# Production & Release
pnpm start:server       # Start production server (requires build first)
pnpm release:rc         # Create release candidate with git tagging
pnpm release:rc major   # Create major version RC (1.0.0 → 2.0.0)
pnpm release:rc minor   # Create minor version RC (1.0.0 → 1.1.0)
```

## 📄 License

This project is licensed under the MIT License.