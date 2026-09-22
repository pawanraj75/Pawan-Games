const http=require('http');
const {WebSocketServer}=require('ws');

const PORT=process.env.PORT||10000;
const rooms=new Map();

function newRoomId(){let id;do{id='PW'+Math.random().toString(36).slice(2,7).toUpperCase()}while(rooms.has(id));return id}
function state(room){
 if(room.kind==='ludo')return {roomId:room.id,kind:'ludo',turn:room.turn,dice:room.dice,status:room.status,winner:room.winner,tokens:room.tokens,players:[...room.players.values()].map(p=>({color:p.color,name:p.name,connected:p.ws.readyState===1}))};
 return {roomId:room.id,board:room.board,turn:room.turn,status:room.status,winner:room.winner,players:[...room.players.values()].map(p=>({symbol:p.symbol,connected:p.ws.readyState===1}))}
}
function ludoStart(color){return {red:0,green:13,yellow:26,blue:39}[color]}
function ludoGlobal(color,pos){return pos<0||pos>51?null:(ludoStart(color)+pos)%52}
function ludoLegal(tokens,color,dice){const out=[];for(let i=0;i<4;i++){const p=tokens[color][i];if(p<0&&dice===6)out.push(i);else if(p>=0&&p+dice<=56)out.push(i)}return out}
function ludoSafe(g){return [0,8,13,21,26,34,39,47].includes(g)}
function ludoNextPlayer(room,color){const order=['red','green','yellow','blue'];let n=order.indexOf(color);for(let k=0;k<4;k++){n=(n+1)%4;if(room.players.has(order[n]))return order[n]}return color}
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
  if(m.type==='create_ludo_room'){
   const id=newRoomId();room={id,kind:'ludo',turn:'red',dice:null,status:'waiting',winner:null,sixStreak:0,rules:{exactHome:true,sixExtraTurn:true,captureExtraTurn:true,safeSquares:true,threeSixPenalty:true},tokens:{red:[-1,-1,-1,-1],green:[-1,-1,-1,-1],yellow:[-1,-1,-1,-1],blue:[-1,-1,-1,-1]},players:new Map()};
   rooms.set(id,room);symbol='red';room.players.set('red',{color:'red',name:String(m.name||'Player 1').slice(0,18),ws});send(ws,{type:'ludo_room_created',color:'red',state:state(room)});broadcastState(room);return
  }
  if(m.type==='join_ludo_room'){
   const r=rooms.get(String(m.roomId||'').toUpperCase());if(!r||r.kind!=='ludo')return send(ws,{type:'error',message:'Ludo room not found'});
   const colors=['red','green','yellow','blue'];const color=colors.find(c=>!r.players.has(c));if(!color)return send(ws,{type:'error',message:'Ludo room is full'});
   room=r;symbol=color;r.players.set(color,{color,name:String(m.name||('Player '+(colors.indexOf(color)+1))).slice(0,18),ws});r.status=r.players.size>=2?'playing':'waiting';send(ws,{type:'ludo_joined',color,state:state(r)});broadcastState(r);return
  }
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
  if(room.kind==='ludo'){
   if(m.type==='chat'){
    const text=String(m.text||'').trim().slice(0,180);if(text)broadcast(room,{type:'chat',color:symbol,name:room.players.get(symbol)?.name||'Player',text,at:Date.now()});return
   }
   if(m.type==='roll_dice'){
    if(room.status!=='playing'||room.turn!==symbol||room.dice!==null)return;
    room.dice=1+Math.floor(Math.random()*6);room.sixStreak=room.dice===6?room.sixStreak+1:0;if(room.sixStreak>=3){room.dice=null;room.sixStreak=0;room.turn=ludoNextPlayer(room,symbol);broadcastState(room);return}const legal=ludoLegal(room.tokens,symbol,room.dice);
    broadcastState(room);
    if(!legal.length){const rolled=room.dice;setTimeout(()=>{if(room&&room.kind==='ludo'&&room.dice===rolled){room.dice=null;const order=['red','green','yellow','blue'];let n=order.indexOf(room.turn);do{n=(n+1)%4}while(!room.players.has(order[n])&&order.some(c=>room.players.has(c)));room.turn=order[n];broadcastState(room)}},650)}
    return
   }
   if(m.type==='ludo_move'){
    if(room.status!=='playing'||room.turn!==symbol||room.dice===null)return;
    const i=Number(m.index),dice=room.dice;if(!Number.isInteger(i)||i<0||i>3)return;
    const oldPos=room.tokens[symbol][i];const legal=ludoLegal(room.tokens,symbol,dice);if(!legal.includes(i))return send(ws,{type:'move_rejected',message:'That token cannot move.'});
    const newPos=oldPos<0?0:oldPos+dice;if(newPos>56)return send(ws,{type:'move_rejected',message:'Exact roll required to reach home.'});room.tokens[symbol][i]=newPos;
    if(newPos>=56)room.tokens[symbol][i]=56;
    const g=ludoGlobal(symbol,room.tokens[symbol][i]);
    if(g!==null){for(const c of ['red','green','yellow','blue']){if(c===symbol)continue;for(let j=0;j<4;j++){const op=room.tokens[c][j];if(op>=0&&op<52&&ludoGlobal(c,op)===g&&!ludoSafe(g))room.tokens[c][j]=-1}}}
    if(room.tokens[symbol].every(p=>p===56)){room.status='finished';room.winner=symbol;room.dice=null;broadcastState(room);return}
    const keep=dice===6;room.dice=null;if(!keep){room.sixStreak=0;const order=['red','green','yellow','blue'];let n=order.indexOf(symbol);for(let k=0;k<4;k++){n=(n+1)%4;if(room.players.has(order[n])){room.turn=order[n];break}}}
    broadcastState(room);return
   }
   return
  }
  if(m.type==='make_move'){
   if(room.status!=='playing')return;
   const i=Number(m.index);if(!Number.isInteger(i)||i<0||i>8||room.turn!==symbol||room.board[i])return send(ws,{type:'move_rejected',message:'Invalid move'});
   room.board[i]=symbol;const result=checkWinner(room.board);
   if(result){room.status='finished';room.winner=result}else room.turn=symbol==='X'?'O':'X';
   broadcastState(room);return
  }
  if(m.type==='rematch'){room.board=Array(9).fill('');room.turn='X';room.status=room.players.size===2?'playing':'waiting';room.winner=null;broadcastState(room)}
 });
 ws.on('close',()=>{if(room&&room.players.get(symbol)?.ws===ws){room.players.delete(symbol);if(room.players.size===0)rooms.delete(room.id);else if(room.kind==='ludo'){room.status='waiting';room.dice=null;broadcastState(room)}else{room.status='waiting';room.board=Array(9).fill('');room.turn='X';room.winner=null;broadcastState(room)}}});
});
server.listen(PORT,()=>console.log('Pawan Games realtime server listening on '+PORT));