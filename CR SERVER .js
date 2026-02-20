const http = require('http');
const WebSocket = require('ws');

const server = http.createServer();
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3000;

const activeRooms = {}; // roomCode => { hostId, banned, users }

server.listen(PORT, () => {
  console.log(`Server running on PORT ${PORT}`);
});

wss.on('connection', (ws) => {
  ws.isKickedOrBanned = false; // flag to prevent sending leave message after kick/ban

  ws.on('message', (message) => {
    let data;
    try {
      data = JSON.parse(message);
    } catch (e) {
      return;
    }

    const { type, roomCode, userId, username } = data;

    if (type === 'createRoom') {
      if (!activeRooms[roomCode]) {
        activeRooms[roomCode] = {
          hostId: userId,
          banned: new Set(),
          users: []
        };
      }

      ws.username = username;
      ws.userId = userId;
      ws.roomCode = roomCode;

      activeRooms[roomCode].users.push({ username, userId, socket: ws });

      ws.send(JSON.stringify({ type: "roomCreated", roomCode }));
      broadcastUserList(roomCode);
    }

    else if (type === 'joinRoom') {
      const room = activeRooms[roomCode];

      if (!room) {
        ws.send(JSON.stringify({ type: "error", message: "Room does not exist!" }));
        return;
      }

      if (room.banned.has(userId)) {
        ws.send(JSON.stringify({ type: "error", message: "You are banned from this room!" }));
        return;
      }

      ws.username = username;
      ws.userId = userId;
      ws.roomCode = roomCode;

      room.users.push({ username, userId, socket: ws });

      ws.send(JSON.stringify({ type: "roomJoined", roomCode }));

      broadcastToRoom(roomCode, {
        type: "message",
        sender: "System",
        message: `${username} has joined the chat.`
      });

      broadcastUserList(roomCode);
    }

    else if (type === 'message') {
      const room = activeRooms[roomCode];
      if (!room) {
        ws.send(JSON.stringify({ type: "error", message: "Room does not exist!" }));
        return;
      }

      broadcastToRoom(roomCode, {
        type: "message",
        sender: data.sender,
        message: data.message
      });
    }

    else if (type === 'leaveRoom') {
      handleUserLeave(ws);
    }

    else if (type === 'kickUser') {
      const room = activeRooms[roomCode];
      if (!room) return;

      if (userId !== room.hostId) {
        ws.send(JSON.stringify({ type: "error", message: "Only the host can kick users!" }));
        return;
      }

      const targetUser = room.users.find(u => u.userId === data.targetId);
      if (!targetUser) return;

      targetUser.socket.isKickedOrBanned = true;
      targetUser.socket.send(JSON.stringify({ type: "kicked" }));
      targetUser.socket.close();

      room.users = room.users.filter(u => u.userId !== data.targetId);

      broadcastToRoom(roomCode, {
        type: "message",
        sender: "System",
        message: `${targetUser.username} has been kicked by the host.`
      });

      broadcastUserList(roomCode);
    }

    else if (type === 'banUser') {
      const room = activeRooms[roomCode];
      if (!room) return;

      if (userId !== room.hostId) {
        ws.send(JSON.stringify({ type: "error", message: "Only the host can ban users!" }));
        return;
      }

      const targetUser = room.users.find(u => u.userId === data.targetId);

      room.banned.add(data.targetId);

      if (targetUser) {
        targetUser.socket.isKickedOrBanned = true;
        targetUser.socket.send(JSON.stringify({ type: "banned" }));
        targetUser.socket.close();

        room.users = room.users.filter(u => u.userId !== data.targetId);

        broadcastToRoom(roomCode, {
          type: "message",
          sender: "System",
          message: `${targetUser.username} has been banned by the host.`
        });

        broadcastUserList(roomCode);
      }
    }
  });

  ws.on('close', () => {
    if (ws.isKickedOrBanned) {
      cleanUpUser(ws);
    } else {
      handleUserLeave(ws);
    }
  });
});

function handleUserLeave(ws) {
  const { roomCode, userId, username } = ws;
  if (!roomCode || !userId) return;

  const room = activeRooms[roomCode];
  if (!room) return;

  const isHost = userId === room.hostId;

  room.users = room.users.filter(u => u.userId !== userId);

  if (isHost) {
    room.users.forEach(user => {
      if (user.socket.readyState === WebSocket.OPEN) {
        user.socket.send(JSON.stringify({ type: "roomClosed" }));
        user.socket.close();
      }
    });
    delete activeRooms[roomCode];
  } else {
    broadcastToRoom(roomCode, {
      type: "message",
      sender: "System",
      message: `${username} has left the chat.`
    });

    if (room.users.length === 0) {
      delete activeRooms[roomCode];
    } else {
      broadcastUserList(roomCode);
    }
  }

  cleanUpUser(ws);
}

function cleanUpUser(ws) {
  ws.roomCode = null;
  ws.userId = null;
  ws.username = null;

  if (ws.readyState === WebSocket.OPEN) {
    ws.close();
  }
}

function broadcastToRoom(roomCode, message) {
  const room = activeRooms[roomCode];
  if (!room) return;

  room.users.forEach(user => {
    if (user.socket.readyState === WebSocket.OPEN) {
      user.socket.send(JSON.stringify(message));
    }
  });
}

function broadcastUserList(roomCode) {
  const room = activeRooms[roomCode];
  if (!room) return;

  const users = room.users.map(u => ({
    username: u.username,
    userId: u.userId
  }));

  room.users.forEach(user => {
    if (user.socket.readyState === WebSocket.OPEN) {
      user.socket.send(JSON.stringify({
        type: "userList",
        users,
        hostId: room.hostId
      }));
    }
  });
}