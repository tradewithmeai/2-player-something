# 2-Player Game

A real-time multiplayer game built with Socket.IO, React, and Fastify.

## 🚀 Quick Start

### Prerequisites

- Node.js >= 18
- pnpm >= 8

### Installation

```bash
pnpm install
```

### Development

Start both server and frontend in development mode:

```bash
pnpm dev
```

This will start:

- Server on http://localhost:3001
- Frontend on http://localhost:5173

### Individual Commands

```bash
# Start only server
pnpm dev:server

# Start only frontend
pnpm dev:frontend

# Build all apps
pnpm build

# Run tests
pnpm test

# Lint code
pnpm lint

# Format code
pnpm format
```

## 🏗 Architecture

### Monorepo Structure

```
2-player-something/
├── apps/
│   ├── server/           # Fastify + Socket.IO server
│   └── frontend/         # React + Vite frontend
├── .github/workflows/    # CI/CD pipelines
└── package.json          # Root workspace configuration
```

### Tech Stack

**Server:**

- [Fastify](https://fastify.io/) - Web framework
- [Socket.IO](https://socket.io/) - Real-time communication
- [TypeScript](https://typescriptlang.org/) - Type safety

**Frontend:**

- [React](https://react.dev/) - UI framework
- [Vite](https://vitejs.dev/) - Build tool
- [Tailwind CSS](https://tailwindcss.com/) - Styling
- [Zustand](https://github.com/pmndrs/zustand) - State management
- [Socket.IO Client](https://socket.io/docs/v4/client-api/) - Real-time client

**Development:**

- [pnpm](https://pnpm.io/) - Package manager
- [TypeScript](https://typescriptlang.org/) - Type checking
- [ESLint](https://eslint.org/) - Code linting
- [Prettier](https://prettier.io/) - Code formatting
- [Vitest](https://vitest.dev/) - Testing framework

## 🧪 Testing

The project includes comprehensive test coverage:

- **Unit Tests**: Server health endpoint tests
- **Integration Tests**: Socket.IO ping/pong communication
- **CI/CD**: Automated testing on GitHub Actions

Run tests:

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch
```

## 🔧 Configuration

### Environment Variables

Create `.env` files in the respective app directories:

**Server** (`apps/server/.env`):

```env
PORT=3001
HOST=0.0.0.0
CLIENT_URL=http://localhost:5173
NODE_ENV=development
```

**Frontend** (`apps/frontend/.env`):

```env
VITE_SERVER_URL=http://localhost:3001
```

## 📱 Features

- ✅ Real-time Socket.IO connection
- ✅ Live connection status indicator
- ✅ Ping/pong communication testing
- ✅ PWA support
- ✅ TypeScript strict mode
- ✅ Comprehensive testing
- ✅ CI/CD pipeline

## 🚀 Deployment

### Build for Production

```bash
pnpm build
```

This creates optimized builds in:

- `apps/server/dist/` - Server build
- `apps/frontend/dist/` - Frontend build

### Production Start

```bash
# Start server
cd apps/server && pnpm start

# Serve frontend (requires a static file server)
cd apps/frontend && pnpm preview
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License.
