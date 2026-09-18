const http=require('http');
const {WebSocketServer}=require('ws');

const PORT=process.env.PORT||10000;
const rooms=new Map();

function newRoomId(){let id;do{id='PW'+Math.random().toString(36).slice(2,7).toUpperCase()}while(rooms.has(id));return id}
function state(room){return {roomId:room.id,board:room.board,turn:room.turn,status:room.status,winner:room.winner,players:[...room.players.values()].map(p=>({symbol:p.symbol,connected:p.ws.readyState===1}))}}
function send(ws,data){if(ws&&ws.readyState===1)ws.send(JSON.stringify(data))}
function broadcast(room,data){for(const p of room.players.values())send(p.ws,data)}
function checkWinner(b){const w=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];for(const a of w)if(a.every(i=>b[i]))return b[a[0]];return b.every(Boolean)?'DRAW':null}
function broadcastState(room){broadcast(room,{type:'game_state',state:state(room)})}

const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,service:'Pawan Games realtime backend'}))});
const wss=new WebSocketServer({server});

wss.on('connection',ws=>{
 let room=null,symbol=null;
 ws.on('message',raw=>{
  let m;try{m=JSON.parse(raw.toString())}catch{return send(ws,{type:'error',message:'Invalid message'})}
  if(m.type==='create_room'){
   const id=newRoomId();room={id,board:Array(9).fill(''),turn:'X',status:'waiting',winner:null,players:new Map()};
   rooms.set(id,room);symbol='X';room.players.set('X',{symbol:'X',ws});send(ws,{type:'room_created',state:state(room)});broadcastState(room);return
  }
  if(m.type==='join_room'){
   const r=rooms.get(String(m.roomId||'').toUpperCase());if(!r)return send(ws,{type:'error',message:'Room not found'});
   if(r.players.has('O'))return send(ws,{type:'error',message:'Room is full'});
   room=r;symbol='O';room.players.set('O',{symbol:'O',ws});r.status='playing';send(ws,{type:'joined',symbol:'O'});broadcastState(r);return
  }
  if(!room||!symbol)return send(ws,{type:'error',message:'Create or join a room first'});
  if(m.type==='make_move'){
   if(room.status!=='playing')return;
   const i=Number(m.index);if(!Number.isInteger(i)||i<0||i>8||room.turn!==symbol||room.board[i])return send(ws,{type:'move_rejected',message:'Invalid move'});
   room.board[i]=symbol;const result=checkWinner(room.board);
   if(result){room.status='finished';room.winner=result}else room.turn=symbol==='X'?'O':'X';
   broadcastState(room);return
  }
  if(m.type==='rematch'){room.board=Array(9).fill('');room.turn='X';room.status=room.players.size===2?'playing':'waiting';room.winner=null;broadcastState(room)}
 });
 ws.on('close',()=>{if(room&&room.players.get(symbol)?.ws===ws){room.players.delete(symbol);if(room.players.size===0)rooms.delete(room.id);else{room.status='waiting';room.board=Array(9).fill('');room.turn='X';room.winner=null;broadcastState(room)}}});
});
server.listen(PORT,()=>console.log('Pawan Games realtime server listening on '+PORT));