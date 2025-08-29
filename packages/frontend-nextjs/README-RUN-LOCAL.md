# Frontend (Next.js) — Run locally

## Prereqs
- Node.js 18+ and npm or pnpm
- An API running at `http://localhost:3001` or set `NEXT_PUBLIC_API_URL`

## 1) Install
```bash
cd packages/frontend-nextjs
npm install
```

## 2) Configure env
Create `.env.local` (or export env vars):
```
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_WS_URL=ws://localhost:3001/ws
```

## 3) Develop
```bash
npm run dev
```

## 4) Build & start
```bash
npm run build
npm start
```

> Tip: If your backend uses a different host/port, update the env vars above.
