# Iranium

A futuristic geopolitical command-room visualizer for Iranium, designed for local demos and Vercel deployment.

## Features
- Black/red terminal-inspired UI
- Live-style scenario feed
- Interactive command panels
- ElizaOS-style commentary layer
- Vercel-ready static frontend and serverless API

## Run locally

### Frontend
```bash
python -m http.server 3000
```
Then open http://localhost:3000/visualizer/index.html

### API
```bash
node api/bridge.js
```

## Deploy to Vercel
1. Push this repository to GitHub.
2. Import it into Vercel.
3. Vercel will serve the static visualizer and the API route automatically.

