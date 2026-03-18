# Dashboard Chat

A full-stack web application that combines a data table dashboard with an AI-powered chat interface. Users can control table operations (filtering, sorting, adding/deleting rows) using natural language commands through LLM tool calling.

**[Live Demo](https://dashboard-chat.pages.dev/)**

## Features

**Chat-Driven Table Operations**
- Filter data by any column with multiple operators (equals, contains, greater than, less than, etc.)
- Sort columns ascending or descending
- Add and delete rows through conversation
- Clear filters and sorting with natural language

**Interactive Data Table**
- Powered by TanStack React Table
- Multi-column filtering with active filter display
- Sortable columns
- Pagination
- Responsive layout

**Real-Time Streaming**
- Server-Sent Events (SSE) for streaming AI responses
- Automatic tool call detection and execution
- Loading states and error handling

## Tech Stack

**Frontend**
- React 18 + TypeScript
- Vite (build tool)
- TanStack React Table
- Tailwind CSS

**Backend**
- Cloudflare Workers
- Groq API (llama-3.3-70b-versatile)
- Server-Sent Events streaming

**Testing**
- Vitest (unit tests)
- Playwright (E2E tests)
- Testing Library

## Getting Started

### Prerequisites

- Node.js 18+
- npm
- [Groq API key](https://console.groq.com)

### Installation

```bash
npm install
```

### Environment Setup

**Backend API** (optional):
```bash
DATABASE_URL=sqlite+aiosqlite:///./data/app.db
CORS_ORIGINS=http://localhost:5173
DEBUG=true
```

**Chat Worker** - Create a `.dev.vars` file in the project root:
```
GROQ_API_KEY=your_groq_api_key_here
CORS_ORIGIN=http://localhost:5173
API_URL=http://api:8000
```

## Development

Start all services with Docker Compose:

```bash
docker compose up
```

Open http://localhost:5173 to use the application.

## Testing

**Unit tests:**
```bash
npm test              # Watch mode
npm run test:run      # Single run
```

**E2E tests** (requires both dev servers running):
```bash
npm run test:e2e:local    # Run tests
npm run test:e2e:ui       # UI mode
npm run test:e2e:debug    # Debug mode
```

## Deployment

The application deploys to Cloudflare:

```bash
npm run build             # Build frontend
npm run deploy:pages      # Deploy frontend to Cloudflare Pages
npm run deploy:worker     # Deploy backend to Cloudflare Workers
```

GitHub Actions automatically deploys on push to main.

## Architecture

```
┌─────────────────┐     POST /chat      ┌───────────────────┐
│                 │ ──────────────────► │                   │
│  React Frontend │                     │ Cloudflare Worker │
│                 │ ◄────────────────── │                   │
└─────────────────┘    SSE Stream       └───────────────────┘
        │                                        │
        │                                        │
        ▼                                        ▼
┌─────────────────┐                     ┌───────────────────┐
│  TanStack Table │                     │     Groq API      │
│  (state mgmt)   │                     │  (tool calling)   │
└─────────────────┘                     └───────────────────┘
```

1. User sends a natural language message
2. Frontend POSTs message history to `/chat` endpoint
3. Worker streams response from Groq API via SSE
4. Frontend parses tool calls and executes table operations
5. TanStack Table state updates trigger UI re-render

## Available Tool Calls

| Tool | Description |
|------|-------------|
| `filterTable` | Filter by column with operators: equals, notEquals, contains, gt, lt, gte, lte |
| `sortTable` | Sort column ascending or descending |
| `addRow` | Add a new row with specified data |
| `deleteRow` | Delete row matching search text |
| `clearFilters` | Remove all active filters |
| `clearSort` | Remove current sorting |

## License

MIT
