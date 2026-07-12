const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

// Define a pasta public para o HTML
app.use(express.static('public'));

function getIceServersFromEnv() {
    const stunUrls = (process.env.STUN_URLS || 'stun:stun.l.google.com:19302')
        .split(',')
        .map((url) => url.trim())
        .filter(Boolean);

    const turnUrls = (process.env.TURN_URLS || '')
        .split(',')
        .map((url) => url.trim())
        .filter(Boolean);

    const iceServers = [];

    if (stunUrls.length > 0) {
        iceServers.push({ urls: stunUrls.length === 1 ? stunUrls[0] : stunUrls });
    }

    if (turnUrls.length > 0) {
        const turnServer = {
            urls: turnUrls.length === 1 ? turnUrls[0] : turnUrls
        };

        if (process.env.TURN_USERNAME) turnServer.username = process.env.TURN_USERNAME;
        if (process.env.TURN_CREDENTIAL) turnServer.credential = process.env.TURN_CREDENTIAL;

        iceServers.push(turnServer);
    }

    return iceServers;
}

const iceServers = getIceServersFromEnv();

const users = {}; // Guarda quem está em qual sala

function getRoomCounts() {
    const counts = {
        'arvore-1': 0,
        'arvore-2': 0
    };

    Object.values(users).forEach((user) => {
        if (counts[user.room] !== undefined) counts[user.room] += 1;
    });

    return counts;
}

function emitirContagemSalas() {
    io.emit('room-counts', getRoomCounts());
}

function getOnlineCount() {
    return Object.keys(users).length;
}

function emitirOnlineCount() {
    io.emit('online-count', getOnlineCount());
}

function emitirPresencaGlobal() {
    emitirContagemSalas();
    emitirOnlineCount();
}

const VALID_ROOMS = new Set(['arvore-1', 'arvore-2']);
const MAX_NICKNAME_LEN = 20;
const MAX_MESSAGE_LEN = 300;

function sanitizarApelido(nickname) {
    if (typeof nickname !== 'string') return 'Macaquinho';
    const limpo = nickname.trim().slice(0, MAX_NICKNAME_LEN);
    return limpo || 'Macaquinho';
}

function nicknameEmUsoNaSala(roomId, nickname, ignoreSocketId) {
    const alvo = nickname.toLowerCase();
    return Object.entries(users).some(([id, user]) => {
        if (id === ignoreSocketId) return false;
        return user.room === roomId && user.nickname.toLowerCase() === alvo;
    });
}

io.on('connection', (socket) => {
    socket.emit('ice-config', iceServers);
    socket.emit('room-counts', getRoomCounts());
    socket.emit('online-count', getOnlineCount());
    
    // Quando um macaco entra na árvore
    socket.on('join-room', (roomId, nickname, callback) => {
        if (!VALID_ROOMS.has(roomId)) {
            if (typeof callback === 'function') callback({ ok: false, reason: 'sala-invalida' });
            return;
        }

        const apelido = sanitizarApelido(nickname);
        if (nicknameEmUsoNaSala(roomId, apelido, socket.id)) {
            if (typeof callback === 'function') callback({ ok: false, reason: 'nick-em-uso' });
            return;
        }

        socket.join(roomId);
        users[socket.id] = { room: roomId, nickname: apelido };
        emitirPresencaGlobal();
        
        // Avisa os outros que ele chegou
        socket.to(roomId).emit('user-connected', socket.id, apelido);
        
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

        if (typeof callback === 'function') callback({ ok: true, nickname: apelido });
    });

    // Troca de dados de Áudio (WebRTC)
    socket.on('signal', (toId, data) => {
        io.to(toId).emit('signal', socket.id, data);
    });

    // Chat de texto
    socket.on('chat-message', (roomId, msg) => {
        if (users[socket.id] && typeof msg === 'string' && msg.trim() && VALID_ROOMS.has(roomId)) {
            socket.to(roomId).emit('chat-message', socket.id, users[socket.id].nickname, msg.slice(0, MAX_MESSAGE_LEN));
        }
    });

    // Atualiza apelido em tempo real sem precisar sair da sala
    socket.on('update-nickname', (newNickname, callback) => {
        if (!users[socket.id]) {
            if (typeof callback === 'function') callback({ ok: false, reason: 'sem-sala' });
            return;
        }

        const normalized = sanitizarApelido(newNickname);
        const roomId = users[socket.id].room;

        if (nicknameEmUsoNaSala(roomId, normalized, socket.id)) {
            if (typeof callback === 'function') callback({ ok: false, reason: 'nick-em-uso' });
            return;
        }

        users[socket.id].nickname = normalized;
        socket.to(roomId).emit('user-nickname-updated', socket.id, normalized);

        if (typeof callback === 'function') callback({ ok: true, nickname: normalized });
    });

    // Quando o macaco clica no botão de sair
    socket.on('leave-room', (roomId) => {
        socket.leave(roomId);
        if (users[socket.id]) delete users[socket.id];
        socket.to(roomId).emit('user-disconnected', socket.id);
        emitirPresencaGlobal();
    });

    // Quando fecha a aba do navegador
    socket.on('disconnect', () => {
        if (users[socket.id]) {
            const roomId = users[socket.id].room;
            socket.to(roomId).emit('user-disconnected', socket.id);
            delete users[socket.id];
            emitirPresencaGlobal();
        }
    });
});

// A MAGIA DA NUVEM TÁ AQUI (com fallback automático de porta)
const BASE_PORT = Number(process.env.PORT) || 3000;
const MAX_PORT_ATTEMPTS = 20;

function iniciarServidorComFallback(portaInicial) {
    let tentativas = 0;

    const tentarOuvir = (portaAtual) => {
        const onError = (err) => {
            if (err && err.code === 'EADDRINUSE' && tentativas < MAX_PORT_ATTEMPTS) {
                tentativas += 1;
                const proximaPorta = portaAtual + 1;
                console.warn(`⚠️ Porta ${portaAtual} ocupada. Tentando ${proximaPorta}...`);
                return tentarOuvir(proximaPorta);
            }

            console.error('❌ Falha ao iniciar o servidor:', err);
            process.exit(1);
        };

        server.once('error', onError);
        server.listen(portaAtual, () => {
            server.off('error', onError);
            console.log(`🐵 MacacoSpeak no ar na porta ${portaAtual}!`);
        });
    };

    tentarOuvir(portaInicial);
}

iniciarServidorComFallback(BASE_PORT);