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
  { number: 1, name: '2 Tríos', description: 'Dos tríos', requiredTrios: 2, requiredScales: 0 },
  { number: 2, name: '1 Trío + 1 Escala', description: 'Un trío y una escala', requiredTrios: 1, requiredScales: 1 },
  { number: 3, name: '2 Escalas', description: 'Dos escalas', requiredTrios: 0, requiredScales: 2 },
  { number: 4, name: '3 Tríos', description: 'Tres tríos', requiredTrios: 3, requiredScales: 0 },
  { number: 5, name: '2 Tríos + 1 Escala', description: 'Dos tríos y una escala', requiredTrios: 2, requiredScales: 1 },
  { number: 6, name: '2 Escalas + 1 Trío', description: 'Dos escalas y un trío', requiredTrios: 1, requiredScales: 2 },
  { number: 7, name: 'Escala Faltante', description: 'Escala del A al K sin pinta', requiredTrios: 0, requiredScales: 1 },
  { number: 8, name: 'Escala Real', description: 'Escala del A al K de la misma pinta', requiredTrios: 0, requiredScales: 1 }
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

function cardRank(card) {
  if (card.isJoker) return 99;
  const map = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, J: 11, Q: 12, K: 13, A: 14 };
  return map[card.value] || 0;
}

function isValidTrio(cards) {
  if (cards.length < 3) return false;
  const normal = cards.filter((c) => !c.isJoker);
  if (normal.length === 0) return false;
  const ranks = normal.map((c) => cardRank(c));
  return new Set(ranks).size === 1;
}

function isValidScale(cards) {
  if (cards.length < 4) return false;
  const normal = cards.filter((c) => !c.isJoker);
  if (normal.length === 0) return false;
  if (new Set(normal.map((c) => c.suit)).size !== 1) return false;
  const ranks = normal.map((c) => cardRank(c)).sort((a, b) => a - b);
  if (new Set(ranks).size !== ranks.length) return false;
  const jokers = cards.length - normal.length;
  let gaps = 0;
  for (let i = 1; i < ranks.length; i++) gaps += ranks[i] - ranks[i - 1] - 1;
  return gaps <= jokers;
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
    scores: {},
    laydowns: {} // { playerId: { trios: [[cardIds]], escalas: [[cardIds]] } }
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
    discard: room.discard.slice(-10).map(serializeCard),
    tableMessage: room.tableMessage,
    laydowns: room.laydowns,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      socketId: player.socketId,
      handCount: player.hand.length,
      score: room.scores[player.id] || 0,
      isHost: player.isHost,
      isCurrent: player.id === currentPlayer?.id,
      laidDown: player.laidDown
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
  room.laydowns = {};
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
    room.laydowns = {};
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

  socket.on('lay-down', ({ trios, escalas, selectedCards }) => {
    const room = findRoomBySocketId(socket.id);
    if (!room || !room.started) return;

    const player = room.players.find((p) => p.socketId === socket.id);
    if (!player) return;

    const currentPlayer = room.players[room.currentPlayerIndex];
    if (currentPlayer.id !== player.id) {
      socket.emit('error-message', 'No es tu turno.');
      return;
    }

    if (player.laidDown) {
      socket.emit('error-message', 'Ya te bajaste en esta ronda.');
      return;
    }

    // Validar que existan los tríos y escalas según la ronda
    const round = ROUNDS[room.currentRound];
    if (trios.length !== round.requiredTrios || escalas.length !== round.requiredScales) {
      socket.emit('error-message', `Esta ronda requiere ${round.requiredTrios} tríos y ${round.requiredScales} escalas.`);
      return;
    }

    // Validar cada trío
    const allTrioCards = trios.flat();
    for (const trioIds of trios) {
      const cards = trioIds.map((id) => player.hand.find((c) => c.id === id)).filter(Boolean);
      if (!isValidTrio(cards)) {
        socket.emit('error-message', 'Uno o más tríos no son válidos.');
        return;
      }
    }

    // Validar cada escala
    const allScaleCards = escalas.flat();
    for (const scaleIds of escalas) {
      const cards = scaleIds.map((id) => player.hand.find((c) => c.id === id)).filter(Boolean);
      if (!isValidScale(cards)) {
        socket.emit('error-message', 'Una o más escalas no son válidas.');
        return;
      }
    }

    // Verificar que no haya cartas duplicadas
    const allIds = [...allTrioCards, ...allScaleCards];
    if (new Set(allIds).size !== allIds.length) {
      socket.emit('error-message', 'Una carta está en dos grupos.');
      return;
    }

    // Remover cartas de la mano
    allIds.forEach((cardId) => {
      const idx = player.hand.findIndex((c) => c.id === cardId);
      if (idx !== -1) player.hand.splice(idx, 1);
    });

    // Guardar la bajada
    player.laidDown = true;
    room.laydowns[player.id] = { trios, escalas };
    room.tableMessage = `${player.name} se bajó con ${trios.length} tríos y ${escalas.length} escalas.`;

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
