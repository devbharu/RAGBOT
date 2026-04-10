# CMTI Bot - Frontend

A modern AI-powered document intelligence chatbot with React, Vite, and Tailwind CSS.

## Features

- 🤖 **AI Chat Interface** - Query documents with streaming responses
- 📄 **Multi-Format Support** - Handle PDF and TXT documents  
- 💾 **Chat History** - Persistent conversation tracking with sidebar
- 🌓 **Dark/Light Mode** - Theme toggle with localStorage persistence
- 📱 **Responsive Design** - Mobile-first UI with hamburger menu
- 🔐 **JWT Authentication** - Secure user sessions with auto-refresh
- ⚡ **Real-time Updates** - Live document indexing status
- 🎨 **Claude-inspired UI** - Clean, professional interface

## Quick Start

### Prerequisites
- Node.js 18+ and npm
- Backend API running at `http://127.0.0.1:8080`

### Installation

```bash
cd frontend
npm install
npm run dev
```

App runs at `http://localhost:5173`

## Project Structure

```
frontend/
├── src/
│   ├── components/
│   │   ├── Chatbot.jsx          # Main chat interface
│   │   ├── Sidebar.jsx          # Chat history sidebar  
│   │   ├── MainLayout.jsx       # Layout container
│   │   ├── PrivateRoute.jsx     # Auth protection
│   │   └── ReportPanel.jsx      # Report generation
│   ├── context/
│   │   ├── AuthContext.jsx      # JWT auth & tokens
│   │   ├── AppContext.jsx       # App state & chat history
│   │   └── ThemeContext.jsx     # Dark/light mode
│   ├── pages/
│   │   ├── Login.jsx
│   │   └── Signup.jsx
│   ├── App.jsx
│   ├── main.jsx
│   └── index.css
├── tailwind.config.js
├── vite.config.js
└── package.json
```

## Architecture

### State Management (React Context)

**ThemeProvider** - Light/dark mode with localStorage persistence
**AuthProvider** - JWT tokens, login/signup/logout, auto-refresh on 401
**AppProvider** - Files, messages, chat history, sidebar state

### Authentication Flow

1. Signup: `/auth/signup` → Create user → Get tokens
2. Login: `/auth/login` → Verify credentials → Get tokens  
3. Auto-Refresh: 401 error → Axios interceptor → `/auth/refresh` → Retry
4. Logout: Clear tokens and session

### Chat History

- Auto-saves after first user message
- Stored in localStorage as JSON
- Click sidebar chat to load previous conversation
- "New Chat" button clears current chat

## Key Components

**Chatbot.jsx**
- Message rendering with streaming tokens
- File upload with progress tracking
- Auto-save to chat history
- Keyboard shortcuts (Enter to send, Shift+Enter for newline)
- Drip-feed animation for token display

**Sidebar.jsx**
- Responsive: fixed+toggle on mobile, static on desktop
- Chat history list with active highlighting
- User info and logout button
- Golden-brown accent color (theme-aware)

**MainLayout.jsx**
- Flex container: Sidebar + main content
- Uses CSS variables for consistent theming

## Styling

- **Framework**: Tailwind CSS 4 with dark mode
- **Dark Mode**: `dark:` prefix for theme variants  
- **CSS Variables**: Used for colors, theme switching
- **Fonts**: DM Mono (code), Fraunces (headers)
- **Accent Color**: Golden-brown (light mode), muted gold (dark mode)

## Development

### Build
```bash
npm run build
```

### Tech Stack
- React 19
- Vite 5
- Tailwind CSS 4
- React Router 7
- Axios
- React Markdown
- Lucide Icons

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/auth/signup` | POST | Register user |
| `/auth/login` | POST | User login |
| `/auth/refresh` | POST | Refresh token |
| `/auth/me` | GET | Get user info |
| `/auth/logout` | POST | Logout |
| `/upload` | POST | Upload document |
| `/files` | GET | List files |
| `/delete` | POST | Delete file |
| `/reindex` | POST | Re-index file |
| `/generate` | POST | AI response |
| `/file/<name>` | GET | Download file |

## Troubleshooting

**White screen**
- Check backend is running on port 8080
- Check browser console for errors
- Verify ThemeProvider wraps App

**Token errors**  
- Auto-refresh happens on next request
- Force logout/login if needed

**Chat history missing**
- Check localStorage enabled
- Clear cache and reload
- Check DevTools → Application → Storage

## Notes

- No TypeScript - Pure JavaScript
- No external state libraries - React Context only
- Responsive breakpoint: 768px (md)
- All console logs are debug-friendly [AUTH], [APP] prefixed
