# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

萌图工坊 (moe-atelier) is a web-based image generation tool that interfaces with OpenAI-compatible APIs (supports OpenAI, Gemini, Google Vertex AI). Features multi-task concurrent generation, task reordering, prompt management, and optional backend mode for multi-device collaboration via SSE.

## Development Commands

```bash
npm install          # Install dependencies
npm run dev          # Start development server (Vite + Express)
npm run build        # TypeScript compile + Vite build
npm run start        # Production server
npm run preview      # Preview production build
```

Docker:
```bash
docker build -t moe-atelier .
docker compose up --build
```

## Architecture

### Tech Stack
- **Frontend:** React 18 + TypeScript 5 + Vite 5 + Ant Design 5
- **Backend:** Express 4 (Node.js, ES modules)
- **Drag & Drop:** @dnd-kit ecosystem

### Key Files
- `src/App.tsx` - Root component, global state management (config, tasks, stats, collections)
- `src/components/ImageTask.tsx` - Core image generation UI (~2350 lines), handles API calls, retries, streaming
- `src/components/ConfigDrawer.tsx` - API configuration panel with multi-format support
- `src/components/PromptDrawer.tsx` - Prompt marketplace interface
- `src/components/TaskGrid.tsx` - Grid layout with drag-and-drop
- `server.mjs` - Main Express server (~1400 lines)
- `server/` - Backend modules (config, storage, SSE, image handling)

### Storage Architecture
**Frontend:**
- localStorage: config (`moe-image-config`), tasks (`moe-image-tasks`), stats, collections
- IndexedDB: image caching (`src/utils/imageDb.ts`)

**Backend (when enabled):**
- `server-data/state.json` - Config & global stats
- `server-data/tasks/{taskId}.json` - Individual task persistence
- `server-data/images/` - Image cache
- `server-data/collection.json` - Shared collections

### API Format Support
Three formats with different URL structures and response parsing:
1. **OpenAI:** `https://api.openai.com/v1`
2. **Gemini:** `https://generativelanguage.googleapis.com`
3. **Vertex AI:** `https://aiplatform.googleapis.com`

See `src/utils/apiUrl.ts` for URL parsing and `src/utils/imageResponse.ts` for response parsing (base64, URLs, Markdown images).

### Backend Mode
Optional server-side state with SSE real-time sync:
1. Set `BACKEND_PASSWORD` in `.env`
2. Toggle backend mode in frontend UI and authenticate
3. Config/tasks/images sync to server-data/

### Key Patterns
- `useDebouncedSync` in `src/utils/inputSync.ts` - Debounced state persistence with retry
- SSE broadcast in `server/sse.mjs` - Real-time sync for backend mode
- Type definitions in `src/types/` - AppConfig, TaskConfig, PersistedImageTaskState, etc.

## Environment Variables

```
BACKEND_PASSWORD=      # Required for backend mode
BACKEND_LOG_REQUESTS=0 # Log incoming requests
BACKEND_LOG_OUTBOUND=0 # Log API calls to model services
BACKEND_LOG_RESPONSE=0 # Log model responses
PORT=5173              # Server port
VITE_HOST=127.0.0.1    # Vite dev host (0.0.0.0 for external access)
```

## Language

Project documentation and commits are in Chinese (Simplified).
