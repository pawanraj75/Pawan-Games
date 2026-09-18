# Realtime Multiplayer Backend Plan

## Goal
Turn the current Tic-Tac-Toe room UI into a real two-player online game where two devices share the same room and game state.

## Proposed first backend
- WebSocket-based realtime server
- Room creation with short random room IDs
- Maximum 2 players per Tic-Tac-Toe room
- Server-authoritative turns and win/draw validation
- Disconnect handling and room cleanup
- No money, deposits, withdrawals or wagering in the MVP

## Client → server messages
- `create_room`
- `join_room`
- `make_move`
- `leave_room`
- `rematch`

## Server → client messages
- `room_created`
- `room_joined`
- `player_joined`
- `game_state`
- `move_rejected`
- `game_finished`
- `player_left`
- `error`

## Security rules
The browser must never be trusted to decide whose turn it is, whether a move is valid, or who won. The server will validate every move.

## Deployment
GitHub Pages can host the static frontend, but realtime server logic needs a separate server/runtime. The frontend will connect to that backend over HTTPS/WSS once the backend is deployed.

## Later
Authentication can attach a verified player ID to each socket/room. Profiles, friends, XP and leaderboards can then use the same player identity.
