const socket = io();

const ui = {
  playerName: document.getElementById('player-name'),
  playerCount: document.getElementById('player-count'),
  roomCode: document.getElementById('room-code'),
  messageBox: document.getElementById('message-box'),
  lobbyPanel: document.getElementById('lobby-panel'),
  gamePanel: document.getElementById('game-panel'),
  roomBadge: document.getElementById('room-badge'),
  roundLabel: document.getElementById('round-label'),
  roundObjective: document.getElementById('round-objective'),
  tableMessage: document.getElementById('table-message'),
  deckCount: document.getElementById('deck-count'),
  discardPreview: document.getElementById('discard-preview'),
  discardCount: document.getElementById('discard-count'),
  playerHand: document.getElementById('player-hand'),
  createRoomBtn: document.getElementById('create-room-btn'),
  joinRoomBtn: document.getElementById('join-room-btn'),
  joinDirectBtn: document.getElementById('join-direct-btn'),
  startGameBtn: document.getElementById('start-game-btn'),
  deckButton: document.getElementById('deck-button'),
  discardButton: document.getElementById('discard-button'),
  layDownBtn: document.getElementById('lay-down-btn')
};

let currentRoom = null;
let currentPlayerId = null;
let playerHand = [];

function showMessage(text, type = '') {
  ui.messageBox.textContent = text;
  ui.messageBox.classList.remove('error', 'success');
  if (type) ui.messageBox.classList.add(type);
}

function getCardDisplay(card) {
  if (card.isJoker) return '🂿';
  const value = card.value === 10 ? '10' : card.value;
  return `${value}${card.suit}`;
}

function getCardColor(card) {
  if (card.isJoker) return 'joker';
  return card.suit === '♥' || card.suit === '♦' ? 'red' : 'black';
}

function createCardElement(card, isPlayable = false) {
  const btn = document.createElement('button');
  btn.className = `card ${getCardColor(card)}`;
  btn.dataset.cardId = card.id;
  btn.type = 'button';

  if (card.isJoker) {
    btn.innerHTML = '<div style="font-size: 2rem;">🂿</div>';
  } else {
    const valueStr = card.value === 10 ? '10' : card.value;
    btn.innerHTML = `
      <div class="card-value">${valueStr}</div>
      <div class="card-suit">${card.suit}</div>
    `;
  }

  if (isPlayable) {
    btn.addEventListener('click', () => {
      socket.emit('discard-card', { cardId: card.id });
    });
  } else {
    btn.disabled = true;
  }

  return btn;
}

function renderPlayers(room) {
  for (let i = 0; i < 4; i++) {
    const seat = document.getElementById(`player-${i}`);
    seat.innerHTML = '';
    const player = room.players[i];

    if (!player) {
      const empty = document.createElement('div');
      empty.className = 'player-info';
      empty.textContent = 'Vacio';
      seat.appendChild(empty);
      continue;
    }

    const info = document.createElement('div');
    info.className = 'player-info';
    const status = document.createElement('div');
    status.className = `player-status ${player.isCurrent ? '' : 'inactive'}`;
    const name = document.createElement('span');
    name.textContent = player.name;
    info.appendChild(status);
    info.appendChild(name);
    seat.appendChild(info);

    const score = document.createElement('div');
    score.className = 'player-score';
    score.textContent = `Puntos: ${player.score}`;
    seat.appendChild(score);

    const count = document.createElement('div');
    count.className = 'player-hand-count';
    count.textContent = `Cartas: ${player.handCount}`;
    seat.appendChild(count);
  }
}

function renderHand() {
  ui.playerHand.innerHTML = '';
  const selfPlayer = currentRoom.players.find((p) => p.id === currentPlayerId);
  const isMyTurn = currentRoom.currentPlayer && currentRoom.currentPlayer.id === currentPlayerId;

  playerHand.forEach((card) => {
    const cardEl = createCardElement(card, isMyTurn);
    ui.playerHand.appendChild(cardEl);
  });
}

function renderRoom(room) {
  currentRoom = room;
  ui.roomBadge.textContent = room.id;
  ui.roundLabel.textContent = `Ronda ${room.currentRound + 1} / 8`;
  if (room.roundInfo) {
    ui.roundObjective.textContent = room.roundInfo.description;
  }
  ui.tableMessage.textContent = room.tableMessage;
  ui.deckCount.textContent = room.deckCount;
  ui.discardCount.textContent = room.discard ? room.discard.length : 0;

  if (room.discardTop) {
    const display = getCardDisplay(room.discardTop);
    ui.discardPreview.textContent = display;
    ui.discardPreview.className = `discard-card ${getCardColor(room.discardTop)}`;
  } else {
    ui.discardPreview.textContent = '';
    ui.discardPreview.className = 'discard-card';
  }

  renderPlayers(room);
  renderHand();

  if (room.started) {
    ui.lobbyPanel.classList.add('hidden');
    ui.gamePanel.classList.remove('hidden');
    ui.startGameBtn.classList.add('hidden');
    ui.deckButton.disabled = currentRoom.currentPlayer?.id !== currentPlayerId;
    ui.discardButton.disabled = currentRoom.currentPlayer?.id !== currentPlayerId;
  } else {
    ui.gamePanel.classList.add('hidden');
    ui.lobbyPanel.classList.remove('hidden');
    ui.startGameBtn.classList.remove('hidden');
  }
}

function bindEvents() {
  ui.createRoomBtn.addEventListener('click', () => {
    const name = ui.playerName.value.trim() || 'Jugador';
    const maxPlayers = Number(ui.playerCount.value) || 4;
    socket.emit('create-room', { name, maxPlayers });
    showMessage('Creando sala...', 'success');
  });

  ui.joinDirectBtn.addEventListener('click', () => {
    const roomId = ui.roomCode.value.trim().toUpperCase();
    const name = ui.playerName.value.trim() || 'Jugador';
    if (!roomId) {
      showMessage('Ingresa un código de sala.', 'error');
      return;
    }
    socket.emit('join-room', { roomId, name });
  });

  ui.startGameBtn.addEventListener('click', () => {
    socket.emit('start-game');
  });

  ui.deckButton.addEventListener('click', () => {
    socket.emit('draw-card', { fromDiscard: false });
  });

  ui.discardButton.addEventListener('click', () => {
    socket.emit('draw-card', { fromDiscard: true });
  });

  ui.layDownBtn.addEventListener('click', () => {
    socket.emit('lay-down');
  });
}

socket.on('joined-room', ({ roomId, playerId }) => {
  currentPlayerId = playerId;
  ui.roomCode.value = roomId;
  ui.roomBadge.textContent = roomId;
  showMessage(`Te uniste a la sala ${roomId}`, 'success');
});

socket.on('room-state', (room) => {
  renderRoom(room);
});

socket.on('player-hand', ({ hand }) => {
  playerHand = hand;
  renderHand();
});

socket.on('error-message', (message) => {
  showMessage(message, 'error');
});

bindEvents();
showMessage('Listo. Crea o únete a una sala.', 'success');
