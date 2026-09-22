const http = require("http");
const crypto = require("crypto");
const WebSocket = require("ws");
const PORT = process.env.PORT || 8080;
const rooms = new Map();

function makeRoomId(){let id;do{id=crypto.randomBytes(3).toString("hex").toUpperCase()}while(rooms.has(id));return id}
function emptyTtt(){return{board:Array(9).fill(""),turn:"X",status:"waiting",winner:null}}
function emptyLudo(){return{kind:"ludo",status:"waiting",turn:"red",dice:null,winner:null,tokens:{red:[-1,-1,-1,-1],green:[-1,-1,-1,-1],yellow:[-1,-1,-1,-1],blue:[-1,-1,-1,-1]}}}
function send(ws,type,payload={}){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type,...payload}))}
function broadcast(room,type,payload={}){for(const p of room.players)send(p.ws,type,payload)}
function tttResult(board){const lines=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];for(const[a,b,c]of lines)if(board[a]&&board[a]===board[b]&&board[a]===board[c])return board[a];return board.every(Boolean)?"DRAW":null}
function publicState(room){
 if(room.kind==="ludo")return{kind:"ludo",roomId:room.id,status:room.game.status,turn:room.game.turn,dice:room.game.dice,winner:room.game.winner,tokens:room.game.tokens,players:room.players.map(p=>({color:p.color,name:p.name,connected:p.ws.readyState===WebSocket.OPEN}))};
 return{kind:"ttt",roomId:room.id,board:room.game.board,turn:room.game.turn,status:room.game.status,winner:room.game.winner,players:room.players.map(p=>({symbol:p.symbol,connected:p.ws.readyState===WebSocket.OPEN}))}
}
function leave(ws){const room=ws.roomId&&rooms.get(ws.roomId);if(!room)return;room.players=room.players.filter(p=>p.ws!==ws);if(!room.players.length)rooms.delete(room.id);else{if(room.kind==="ludo"){room.game.status="waiting";room.game.dice=null}else{room.game.status="waiting";room.game.winner=null}broadcast(room,"player_left",{state:publicState(room)})}ws.roomId=null}
function ludoCanMove(pos,dice){return dice!=null&&((pos===-1&&dice===6)||(pos>=0&&pos<56&&pos+dice<=56))}
function ludoStart(room){room.game.status=room.players.length>=2?"playing":"waiting";room.game.turn="red";room.game.dice=null;room.game.winner=null;room.game.tokens={red:[-1,-1,-1,-1],green:[-1,-1,-1,-1],yellow:[-1,-1,-1,-1],blue:[-1,-1,-1,-1]}}
function ludoMove(room,player,index){
 if(room.game.status!=="playing"||room.game.turn!==player.color)return false;
 const dice=room.game.dice;if(!Number.isInteger(index)||index<0||index>3)return false;
 const tokens=room.game.tokens[player.color];if(!ludoCanMove(tokens[index],dice))return false;
 const next=tokens[index]===-1?0:tokens[index]+dice;tokens[index]=next;
 const starts={red:0,green:13,yellow:26,blue:39},safe=new Set([0,8,13,21,26,34,39,47]);
 if(next<56&&!safe.has((starts[player.color]+next)%52)){
  for(const c of ["red","green","yellow","blue"])if(c!==player.color)for(let i=0;i<4;i++){const op=room.game.tokens[c][i];if(op>=0&&op<56&&(starts[c]+op)%52===(starts[player.color]+next)%52)room.game.tokens[c][i]=-1}
 }
 if(tokens.every(x=>x===56)){room.game.status="finished";room.game.winner=player.color;room.game.dice=null;return true}
 room.game.dice=null;
 if(dice!==6){const order=["red","green","yellow","blue"];room.game.turn=order[(order.indexOf(player.color)+1)%4]}
 return true
}
const path=require("path"),fs=require("fs");
const frontendRoot=path.resolve(__dirname,"..");
const mimeTypes={".html":"text/html; charset=utf-8",".js":"application/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".webmanifest":"application/manifest+json; charset=utf-8",".svg":"image/svg+xml",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".ico":"image/x-icon"};
function serveFrontend(req,res){const requestPath=decodeURIComponent((req.url||"/").split("?")[0]);if(requestPath==="/health"){res.writeHead(200,{"content-type":"application/json; charset=utf-8"});return res.end(JSON.stringify({service:"Pawan Games realtime server",status:"ok"}))}
 const relativePath=requestPath==="/"?"index.html":requestPath.replace(/^\/+/, "");const filePath=path.resolve(frontendRoot,relativePath);
 if(filePath!==frontendRoot&&!filePath.startsWith(frontendRoot+path.sep)){res.writeHead(403,{"content-type":"text/plain; charset=utf-8"});return res.end("Forbidden")}
 fs.stat(filePath,(err,stat)=>{if(!err&&stat.isFile()){const ext=path.extname(filePath).toLowerCase();res.writeHead(200,{"content-type":mimeTypes[ext]||"application/octet-stream","cache-control":requestPath==="/"?"no-cache":"public, max-age=300"});return fs.createReadStream(filePath).pipe(res)}res.writeHead(404,{"content-type":"text/plain; charset=utf-8"});res.end("Not found")})}
const server=http.createServer(serveFrontend),wss=new WebSocket.Server({server});
wss.on("connection",ws=>{ws.on("message",raw=>{let msg;try{msg=JSON.parse(raw.toString())}catch{return send(ws,"error",{message:"Invalid JSON."})}
 if(msg.type==="create_room"){leave(ws);const id=makeRoomId(),room={id,kind:"ttt",players:[],game:emptyTtt()};room.players.push({ws,symbol:"X"});rooms.set(id,room);ws.roomId=id;return send(ws,"room_created",{state:publicState(room)})}
 if(msg.type==="join_room"){const id=String(msg.roomId||"").trim().toUpperCase(),room=rooms.get(id);if(!room)return send(ws,"error",{message:"Room not found."});if(room.kind!=="ttt")return send(ws,"error",{message:"This is not a Tic-Tac-Toe room."});if(room.players.length>=2)return send(ws,"error",{message:"Room is full."});leave(ws);room.players.push({ws,symbol:"O"});ws.roomId=id;room.game=emptyTtt();room.game.status="playing";return broadcast(room,"game_state",{state:publicState(room)})}
 if(msg.type==="create_ludo_room"){leave(ws);const id=makeRoomId(),room={id,kind:"ludo",players:[],game:emptyLudo()};room.players.push({ws,color:"red",name:String(msg.name||"Player").slice(0,24)});rooms.set(id,room);ws.roomId=id;ludoStart(room);return send(ws,"ludo_room_created",{color:"red",state:publicState(room)})}
 if(msg.type==="join_ludo_room"){const id=String(msg.roomId||"").trim().toUpperCase(),room=rooms.get(id);if(!room||room.kind!=="ludo")return send(ws,"error",{message:"Ludo room not found."});if(room.players.length>=4)return send(ws,"error",{message:"Ludo room is full."});leave(ws);const used=new Set(room.players.map(p=>p.color)),color=["red","green","yellow","blue"].find(c=>!used.has(c));room.players.push({ws,color,name:String(msg.name||"Player").slice(0,24)});ws.roomId=id;ludoStart(room);return broadcast(room,"ludo_joined",{color,state:publicState(room)})}
 const room=ws.roomId&&rooms.get(ws.roomId);if(!room)return send(ws,"error",{message:"Join or create a room first."});const player=room.players.find(p=>p.ws===ws);
 if(msg.type==="make_move"){if(room.kind!=="ttt")return send(ws,"move_rejected",{message:"Not a Tic-Tac-Toe room."});const i=Number(msg.index);if(room.game.status!=="playing"||!player||player.symbol!==room.game.turn||!Number.isInteger(i)||i<0||i>8||room.game.board[i])return send(ws,"move_rejected",{message:"Invalid move."});room.game.board[i]=player.symbol;const winner=tttResult(room.game.board);if(winner){room.game.status="finished";room.game.winner=winner}else room.game.turn=player.symbol==="X"?"O":"X";return broadcast(room,"game_state",{state:publicState(room)})}
 if(msg.type==="roll_dice"){if(room.kind!=="ludo"||room.game.status!=="playing"||room.game.turn!==player.color||room.game.dice!==null)return send(ws,"error",{message:"You cannot roll now."});room.game.dice=crypto.randomInt(1,7);if(!room.game.tokens[player.color].some(p=>ludoCanMove(p,room.game.dice))){const d=room.game.dice;room.game.dice=null;if(d!==6){const order=["red","green","yellow","blue"];room.game.turn=order[(order.indexOf(player.color)+1)%4]}}return broadcast(room,"game_state",{state:publicState(room)})}
 if(msg.type==="ludo_move"){if(room.kind!=="ludo")return send(ws,"move_rejected",{message:"Not a Ludo room."});if(!ludoMove(room,player,Number(msg.index)))return send(ws,"move_rejected",{message:"That token cannot move with this dice roll."});return broadcast(room,"game_state",{state:publicState(room)})}
 if(msg.type==="chat"){if(room.kind!=="ludo")return send(ws,"error",{message:"Chat is available in Ludo rooms."});const text=String(msg.text||"").trim().slice(0,300);if(text)return broadcast(room,"chat",{name:player.name,color:player.color,text})}
 if(msg.type==="rematch"){if(room.kind==="ludo"){if(room.players.length<2)return send(ws,"error",{message:"At least two players are required."});ludoStart(room);return broadcast(room,"game_state",{state:publicState(room)})}if(room.players.length!==2)return send(ws,"error",{message:"Both players must be connected."});room.game=emptyTtt();room.game.status="playing";return broadcast(room,"game_state",{state:publicState(room)})}
 if(msg.type==="leave_room")leave(ws);
 });ws.on("close",()=>leave(ws))});
server.listen(PORT,()=>console.log("Pawan Games realtime server listening on "+PORT));