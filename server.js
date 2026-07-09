const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

// Define a pasta public para o HTML
app.use(express.static('public'));

const users = {}; // Guarda quem está em qual sala

io.on('connection', (socket) => {
    
    // Quando um macaco entra na árvore
    socket.on('join-room', (roomId, nickname) => {
        socket.join(roomId);
        users[socket.id] = { room: roomId, nickname: nickname };
        
        // Avisa os outros que ele chegou
        socket.to(roomId).emit('user-connected', socket.id, nickname);
        
        // Manda a lista de quem já tá na sala pro novato
        const usersInRoom = {};
        const room = io.sockets.adapter.rooms.get(roomId);
        if (room) {
            for (let id of room) {
                if (id !== socket.id && users[id]) {
                    usersInRoom[id] = users[id].nickname;
                }
            }
        }
        socket.emit('current-room-users', usersInRoom);
    });

    // Troca de dados de Áudio (WebRTC)
    socket.on('signal', (toId, data) => {
        io.to(toId).emit('signal', socket.id, data);
    });

    // Chat de texto
    socket.on('chat-message', (roomId, msg) => {
        if (users[socket.id]) {
            socket.to(roomId).emit('chat-message', socket.id, users[socket.id].nickname, msg);
        }
    });

    // Quando o macaco clica no botão de sair
    socket.on('leave-room', (roomId) => {
        socket.leave(roomId);
        if (users[socket.id]) delete users[socket.id];
        socket.to(roomId).emit('user-disconnected', socket.id);
    });

    // Quando fecha a aba do navegador
    socket.on('disconnect', () => {
        if (users[socket.id]) {
            const roomId = users[socket.id].room;
            socket.to(roomId).emit('user-disconnected', socket.id);
            delete users[socket.id];
        }
    });
});

// A MAGIA DA NUVEM TÁ AQUI (A porta muda sozinha)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🐵 MacacoSpeak no ar na porta ${PORT}!`);
});