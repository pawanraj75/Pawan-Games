const http = require("http");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;
const rooms = new Map();

function makeRoomId() {
  let id;
  do { id = crypto.randomBytes(3).toString("hex").toUpperCase(); }
  while (rooms.has(id));
  return id;
}

function emptyGame() {
  return { board: Array(9).fill(""), turn: "X", status: "waiting", winner: null };
}

function send(ws, type, payload = {}) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...payload }));
}

function broadcast(room, type, payload = {}) {
  for (const player of room.players) send(player.ws, type, payload);
}

function result(board) {
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (const [a,b,c] of lines) if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  return board.every(Boolean) ? "DRAW" : null;
}

function state(room) {
  return { roomId: room.id, board: room.game.board, turn: room.game.turn, status: room.game.status, winner: room.game.winner, players: room.players.map(p => ({ symbol:p.symbol, connected:p.ws.readyState === WebSocket.OPEN })) };
}

function leave(ws) {
  const room = ws.roomId && rooms.get(ws.roomId);
  if (!room) return;
  room.players = room.players.filter(p => p.ws !== ws);
  if (room.players.length === 0) rooms.delete(room.id);
  else {
    room.game.status = "waiting";
    room.game.winner = null;
    broadcast(room, "player_left", { state: state(room) });
  }
  ws.roomId = null;
}

const path = require("path");
const fs = require("fs");

const frontendRoot = path.resolve(__dirname, "..");
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

function serveFrontend(req, res) {
  const requestPath = decodeURIComponent((req.url || "/").split("?")[0]);
  const relativePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const filePath = path.resolve(frontendRoot, relativePath);

  // Prevent requests from escaping the repository root.
  if (filePath !== frontendRoot && !filePath.startsWith(frontendRoot + path.sep)) {
    res.writeHead(403, {"content-type": "text/plain; charset=utf-8"});
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (statErr, stat) => {
    if (!statErr && stat.isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        "content-type": mimeTypes[ext] || "application/octet-stream",
        "cache-control": requestPath === "/" ? "no-cache" : "public, max-age=300",
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // Keep a simple JSON health response available at /health.
    if (requestPath === "/health") {
      res.writeHead(200, {"content-type": "application/json; charset=utf-8"});
      res.end(JSON.stringify({ service: "Pawan Games realtime server", status: "ok" }));
      return;
    }

    res.writeHead(404, {"content-type": "text/plain; charset=utf-8"});
    res.end("Not found");
  });
}

const server = http.createServer((req,res) => {
  serveFrontend(req, res);
});

const wss = new WebSocket.Server({ server });

wss.on("connection", ws => {
  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return send(ws, "error", { message:"Invalid JSON." }); }

    if (msg.type === "create_room") {
      leave(ws);
      const id = makeRoomId();
      const room = { id, players: [], game: emptyGame() };
      room.players.push({ ws, symbol:"X" });
      rooms.set(id, room);
      ws.roomId = id;
      send(ws, "room_created", { state: state(room) });
      return;
    }

    if (msg.type === "join_room") {
      const id = String(msg.roomId || "").trim().toUpperCase();
      const room = rooms.get(id);
      if (!room) return send(ws, "error", { message:"Room not found." });
      if (room.players.some(p => p.ws === ws)) return send(ws, "error", { message:"Already in this room." });
      if (room.players.length >= 2) return send(ws, "error", { message:"Room is full." });
      leave(ws);
      room.players.push({ ws, symbol:"O" });
      ws.roomId = id;
      room.game = emptyGame();
      room.game.status = "playing";
      broadcast(room, "game_state", { state: state(room) });
      return;
    }

    const room = ws.roomId && rooms.get(ws.roomId);
    if (!room) return send(ws, "error", { message:"Join or create a room first." });
    const player = room.players.find(p => p.ws === ws);

    if (msg.type === "make_move") {
      const i = Number(msg.index);
      if (room.game.status !== "playing") return send(ws, "move_rejected", { message:"Game is not active." });
      if (!player || player.symbol !== room.game.turn) return send(ws, "move_rejected", { message:"Not your turn." });
      if (!Number.isInteger(i) || i < 0 || i > 8 || room.game.board[i]) return send(ws, "move_rejected", { message:"Invalid move." });
      room.game.board[i] = player.symbol;
      const winner = result(room.game.board);
      if (winner) {
        room.game.status = "finished";
        room.game.winner = winner;
      } else room.game.turn = player.symbol === "X" ? "O" : "X";
      broadcast(room, "game_state", { state: state(room) });
      return;
    }

    if (msg.type === "rematch") {
      if (room.players.length !== 2) return send(ws, "error", { message:"Both players must be connected." });
      room.game = emptyGame();
      room.game.status = "playing";
      broadcast(room, "game_state", { state: state(room) });
      return;
    }

    if (msg.type === "leave_room") leave(ws);
  });

  ws.on("close", () => leave(ws));
});

server.listen(PORT, () => console.log("Pawan Games realtime server listening on " + PORT));