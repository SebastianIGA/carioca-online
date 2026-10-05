const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 4;

// Naipe inglés tradicional (sin comodines), con 2 mazos
const SUITS = ['♥', '♦', '♣', '♠'];
const VALUES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 'J', 'Q', 'K', 'A'];

// Rondas correctas del Carioca clásico según tu especificación
const ROUNDS = [
  { number: 1, name: '2 Tríos', description: 'Dos tríos' },
  { number: 2, name: '1 Trío + 1 Escala', description: 'Un trío y una escala' },
  { number: 3, name: '2 Escalas', description: 'Dos escalas' },
  { number: 4, name: '3 Tríos', description: 'Tres tríos' },
  { number: 5, name: '2 Tríos + 1 Escala', description: 'Dos tríos y una escala' },
  { number: 6, name: '2 Escalas + 1 Trío', description: 'Dos escalas y un trío' },
  { number: 7, name: 'Escala Faltante', description: 'Escala del A al K sin pinta' },
  { number: 8, name: 'Escala Real', description: 'Escala del A al K de la misma pinta' }
];

const rooms = new Map();

function shuffle(array) {
  const clone = [...array];
  for (let i = clone.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [clone[i], clone[j]] = [clone[j], clone[i]];
  }
  return clone;
}

function createDeck() {
  const cards = [];
  // Dos mazos ingleses completos sin comodines
  for (let deck = 0; deck < 2; deck++) {
    SUITS.forEach((suit) => {
      VALUES.forEach((value) => {
        cards.push({
          id: `${suit}-${value}-${deck}-${uuidv4()}`,
          suit,
          value,
          isJoker: false
        });
      });
    });
  }
  return shuffle(cards);
}

function cardNumericValue(card) {
  if (card.isJoker) return 25;
  const map = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, J: 10, Q: 10, K: 10, A: 15 };
  return map[card.value] || 0;
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function createRoom(name, maxPlayers = 4) {
  const roomId = generateRoomCode();
  const room = {
    id: roomId,
    name,
    maxPlayers,
    players: [],
    started: false,
    currentRound: 0,
    currentPlayerIndex: 0,
    deck: [],
    discard: [],
    tableMessage: 'Esperando jugadores...',
    scores: {}
  };
  rooms.set(roomId, room);
  return room;
}

function serializeCard(card) {
  return {
    id: card.id,
    suit: card.suit,
    value: card.value,
    isJoker: card.isJoker
  };
}

function serializeRoom(room) {
  const currentPlayer = room.players[room.currentPlayerIndex];
  return {
    id: room.id,
    name: room.name,
    maxPlayers: room.maxPlayers,
    started: room.started,
    currentRound: room.currentRound,
    roundInfo: room.started ? ROUNDS[room.currentRound] : null,
    currentPlayer: currentPlayer ? { id: currentPlayer.id, name: currentPlayer.name } : null,
    deckCount: room.deck.length,
    discardTop: room.discard.length > 0 ? serializeCard(room.discard[room.discard.length - 1]) : null,
    tableMessage: room.tableMessage,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      socketId: player.socketId,
      handCount: player.hand.length,
      score: room.scores[player.id] || 0,
      isHost: player.isHost,
      isCurrent: player.id === currentPlayer?.id
    }))
  };
}

function emitRoomState(room) {
  io.to(room.id).emit('room-state', serializeRoom(room));
  room.players.forEach((player) => {
    io.to(player.socketId).emit('player-hand', {
      hand: player.hand.map(serializeCard)
    });
  });
}

function findRoomBySocketId(socketId) {
  for (const room of rooms.values()) {
    if (room.players.some((p) => p.socketId === socketId)) {
      return room;
    }
  }
  return null;
}

function dealCards(room) {
  const handSize = 12;
  room.players.forEach((player) => {
    player.hand = [];
    player.laidDown = false;
    for (let i = 0; i < handSize; i++) {
      if (room.deck.length > 0) {
        player.hand.push(room.deck.pop());
      }
    }
  });

  if (room.deck.length > 0) {
    room.discard.push(room.deck.pop());
  }
}

function startGame(room) {
  room.started = true;
  room.currentRound = 0;
  room.currentPlayerIndex = 0;
  room.scores = {};
  room.players.forEach((player) => {
    room.scores[player.id] = 0;
  });

  room.deck = createDeck();
  room.discard = [];
  room.tableMessage = `Ronda 1: ${ROUNDS[0].description}`;
  dealCards(room);
  emitRoomState(room);
}

function endRound(room) {
  // Sumar puntos: cada jugador suma las cartas que le quedan en mano
  room.players.forEach((player) => {
    player.hand.forEach((card) => {
      room.scores[player.id] = (room.scores[player.id] || 0) + cardNumericValue(card);
    });
  });

  room.currentRound += 1;

  if (room.currentRound < ROUNDS.length) {
    room.currentPlayerIndex = 0;
    room.deck = createDeck();
    room.discard = [];
    room.tableMessage = `Ronda ${room.currentRound + 1}: ${ROUNDS[room.currentRound].description}`;
    dealCards(room);
  } else {
    room.started = false;
    const sorted = [...room.players].sort((a, b) => (room.scores[a.id] || 0) - (room.scores[b.id] || 0));
    room.tableMessage = `Fin del juego. Ganador: ${sorted[0].name} con ${room.scores[sorted[0].id] || 0} puntos.`;
  }

  emitRoomState(room);
}

io.on('connection', (socket) => {
  socket.on('create-room', ({ name, maxPlayers }) => {
    const cleanName = (name || 'Jugador').trim().slice(0, 18) || 'Jugador';
    const safeMaxPlayers = Math.min(Math.max(Number(maxPlayers) || 4, 2), MAX_PLAYERS);
    const room = createRoom(`${cleanName}'s room`, safeMaxPlayers);

    const player = {
      id: uuidv4(),
      name: cleanName,
      socketId: socket.id,
      hand: [],
      laidDown: false,
      isHost: true
    };

    room.players.push(player);
    socket.join(room.id);
    socket.data.roomId = room.id;
    socket.data.playerId = player.id;

    socket.emit('joined-room', { roomId: room.id, playerId: player.id });
    emitRoomState(room);
  });

  socket.on('join-room', ({ roomId, name }) => {
    const room = rooms.get(String(roomId).toUpperCase());
    if (!room) {
      socket.emit('error-message', 'La sala no existe.');
      return;
    }

    if (room.players.length >= room.maxPlayers) {
      socket.emit('error-message', 'La sala está llena.');
      return;
    }

    const cleanName = (name || 'Jugador').trim().slice(0, 18) || 'Jugador';
    const player = {
      id: uuidv4(),
      name: cleanName,
      socketId: socket.id,
      hand: [],
      laidDown: false,
      isHost: false
    };

    room.players.push(player);
    socket.join(room.id);
    socket.data.roomId = room.id;
    socket.data.playerId = player.id;

    socket.emit('joined-room', { roomId: room.id, playerId: player.id });
    emitRoomState(room);
  });

  socket.on('start-game', () => {
    const room = findRoomBySocketId(socket.id);
    if (!room) return;

    if (room.players.length < 2) {
      socket.emit('error-message', 'Se necesitan al menos 2 jugadores.');
      return;
    }

    startGame(room);
  });

  socket.on('draw-card', ({ fromDiscard }) => {
    const room = findRoomBySocketId(socket.id);
    if (!room || !room.started) return;

    const player = room.players.find((p) => p.socketId === socket.id);
    if (!player) return;

    const currentPlayer = room.players[room.currentPlayerIndex];
    if (currentPlayer.id !== player.id) {
      socket.emit('error-message', 'No es tu turno.');
      return;
    }

    let drawnCard;
    if (fromDiscard && room.discard.length > 0) {
      drawnCard = room.discard.pop();
      room.tableMessage = `${player.name} robó de descarte.`;
    } else if (room.deck.length > 0) {
      drawnCard = room.deck.pop();
      room.tableMessage = `${player.name} robó del mazo.`;
    } else {
      socket.emit('error-message', 'No hay cartas disponibles.');
      return;
    }

    player.hand.push(drawnCard);
    emitRoomState(room);
  });

  socket.on('discard-card', ({ cardId }) => {
    const room = findRoomBySocketId(socket.id);
    if (!room || !room.started) return;

    const player = room.players.find((p) => p.socketId === socket.id);
    if (!player) return;

    const currentPlayer = room.players[room.currentPlayerIndex];
    if (currentPlayer.id !== player.id) {
      socket.emit('error-message', 'No es tu turno.');
      return;
    }

    const cardIndex = player.hand.findIndex((c) => c.id === cardId);
    if (cardIndex === -1) {
      socket.emit('error-message', 'Esa carta no está en tu mano.');
      return;
    }

    const card = player.hand.splice(cardIndex, 1)[0];
    room.discard.push(card);
    room.tableMessage = `${player.name} descartó ${card.value}${card.suit}.`;

    if (player.hand.length === 0) {
      endRound(room);
    } else {
      room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
      emitRoomState(room);
    }
  });

  socket.on('lay-down', () => {
    const room = findRoomBySocketId(socket.id);
    if (!room || !room.started) return;

    const player = room.players.find((p) => p.socketId === socket.id);
    if (!player) return;

    player.laidDown = true;
    room.tableMessage = `${player.name} se bajó en la ronda.`;
    emitRoomState(room);
  });

  socket.on('disconnect', () => {
    const room = findRoomBySocketId(socket.id);
    if (!room) return;

    room.players = room.players.filter((p) => p.socketId !== socket.id);

    if (room.players.length === 0) {
      rooms.delete(room.id);
    } else {
      if (room.started && room.currentPlayerIndex >= room.players.length) {
        room.currentPlayerIndex = 0;
      }
      room.tableMessage = 'Un jugador abandonó la sala.';
      emitRoomState(room);
    }
  });
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', rooms: rooms.size });
});

server.listen(PORT, () => {
  console.log(`🎴 Carioca Online - Servidor activo en http://localhost:${PORT}`);
});
