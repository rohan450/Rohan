const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const activeRooms = {}; // Stores all room data

// Simple homepage route for Glitch
app.get("/", (req, res) => {
    res.send("WebSocket server is running.");
});

// WebSocket connection handling
wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        let data;
        
        try {
            data = JSON.parse(message); // Parsing incoming message
        } catch (err) {
            ws.send(JSON.stringify({ type: "error", message: "Invalid message format" }));
            return;
        }

        // CREATE ROOM
        if (data.type === "createRoom") {
            if (!activeRooms[data.roomCode]) {
                activeRooms[data.roomCode] = {
                    hostId: data.userId,
                    banned: new Set(),
                    users: []
                };
            }

            ws.username = data.username;
            ws.userId = data.userId;
            ws.roomCode = data.roomCode;

            activeRooms[data.roomCode].users.push({ username: data.username, userId: data.userId, socket: ws });

            ws.send(JSON.stringify({ type: "roomCreated", roomCode: data.roomCode }));
            broadcastUserList(data.roomCode);
        }

        // JOIN ROOM
        else if (data.type === "joinRoom") {
            if (!activeRooms[data.roomCode]) {
                ws.send(JSON.stringify({ type: "error", message: "Room does not exist!" }));
                return;
            }

            const room = activeRooms[data.roomCode];

            if (room.banned.has(data.userId)) {
                ws.send(JSON.stringify({ type: "error", message: "You are banned from this room!" }));
                return;
            }

            ws.username = data.username;
            ws.userId = data.userId;
            ws.roomCode = data.roomCode;

            room.users.push({ username: data.username, userId: data.userId, socket: ws });

            ws.send(JSON.stringify({ type: "roomJoined", roomCode: data.roomCode }));

            broadcastToRoom(data.roomCode, {
                type: "message",
                sender: "System",
                message: `${data.username} has joined the chat.`,
            });

            broadcastUserList(data.roomCode);
        }

        // CHAT MESSAGE
        else if (data.type === "message") {
            if (!activeRooms[data.roomCode]) {
                ws.send(JSON.stringify({ type: "error", message: "Room does not exist!" }));
                return;
            }

            broadcastToRoom(data.roomCode, {
                type: "message",
                sender: data.sender,
                message: data.message,
            });
        }

        // LEAVE ROOM
        else if (data.type === "leaveRoom") {
            if (!activeRooms[data.roomCode]) return;

            const room = activeRooms[data.roomCode];
            room.users = room.users.filter(user => user.userId !== data.userId);

            broadcastToRoom(data.roomCode, {
                type: "message",
                sender: "System",
                message: `${data.username} has left the chat.`,
            });

            if (room.users.length === 0) {
                delete activeRooms[data.roomCode];
            } else {
                broadcastUserList(data.roomCode);
            }

            ws.close();
        }

        // KICK USER
        else if (data.type === "kickUser") {
            const room = activeRooms[data.roomCode];
            if (!room) return;

            if (data.userId !== room.hostId) {
                ws.send(JSON.stringify({ type: "error", message: "Only the host can kick users!" }));
                return;
            }

            const targetUser = room.users.find(u => u.userId === data.targetId);
            if (!targetUser) return;

            // Notify and remove the kicked user
            targetUser.socket.send(JSON.stringify({ type: "kicked" }));
            room.users = room.users.filter(u => u.userId !== data.targetId);

            broadcastToRoom(data.roomCode, {
                type: "message",
                sender: "System",
                message: `${targetUser.username} has been kicked by the host.`
            });

            broadcastUserList(data.roomCode);
        }
    });

    // ON DISCONNECT
    ws.on('close', () => {
        for (let roomCode in activeRooms) {
            const room = activeRooms[roomCode];
            room.users = room.users.filter(user => user.socket !== ws);
            if (room.users.length === 0) {
                delete activeRooms[roomCode];
            } else {
                broadcastUserList(roomCode);
            }
        }
    });
});

// SEND MESSAGE TO ALL USERS IN A ROOM
function broadcastToRoom(roomCode, message) {
    const room = activeRooms[roomCode];
    if (!room) return;

    room.users.forEach(user => {
        if (user.socket.readyState === WebSocket.OPEN) {
            user.socket.send(JSON.stringify(message));
        }
    });
}

// SEND UPDATED USER LIST TO ROOM
function broadcastUserList(roomCode) {
    const room = activeRooms[roomCode];
    if (!room) return;

    const userList = room.users.map(u => ({
        username: u.username,
        userId: u.userId
    }));

    room.users.forEach(user => {
        if (user.socket.readyState === WebSocket.OPEN) {
            user.socket.send(JSON.stringify({
                type: "userList",
                users: userList,
                hostId: room.hostId
            }));
        }
    });
}

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
