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
  startGameSection: document.getElementById('start-game-section'),
  deckButton: document.getElementById('deck-button'),
  discardButton: document.getElementById('discard-button'),
  layDownBtn: document.getElementById('lay-down-btn'),
  layDownModal: document.getElementById('laydown-modal'),
  layDownHand: document.getElementById('laydown-hand'),
  triosSelection: document.getElementById('trios-selection'),
  scalesSelection: document.getElementById('scales-selection'),
  confirmLayDownBtn: document.getElementById('confirm-laydown-btn'),
  cancelLayDownBtn: document.getElementById('cancel-laydown-btn'),
  layDownStatus: document.getElementById('laydown-status')
};

const MUST_DRAW_MESSAGE = 'Debes robar primero';
const JOKER_FACE = '🃏';

// Qué asiento (player-N) usa cada jugador según la cantidad de jugadores
const SEAT_MAP = {
  1: [3],
  2: [1, 2], // izquierda y derecha
  3: [1, 0, 2], // izquierda, arriba, derecha
  4: [0, 1, 2, 3]
};

let currentRoom = null;
let currentPlayerId = null;
let playerHand = [];
let localHandOrder = [];
let draggedCardId = null;
let laydownDraft = { trios: [], escalas: [] };
let laydownSelection = [];

function showMessage(text, type = '') {
  ui.messageBox.textContent = text;
  ui.messageBox.classList.remove('error', 'success');
  if (type) ui.messageBox.classList.add(type);
}

function isMyTurn() {
  return !!(currentRoom && currentRoom.currentPlayer && currentRoom.currentPlayer.id === currentPlayerId);
}

function haveILaidDown() {
  if (!currentRoom) return false;
  const me = currentRoom.players.find((p) => p.id === currentPlayerId);
  return !!(me && me.laidDown);
}

function mustDrawFirst() {
  return playerHand.length === 12;
}

function getCardDisplay(card) {
  if (card.isJoker) return JOKER_FACE;
  const value = card.value === 10 ? '10' : card.value;
  return `${value}${card.suit}`;
}

function getCardColor(card) {
  if (card.isJoker) return 'joker';
  return card.suit === '♥' || card.suit === '♦' ? 'red' : 'black';
}

function getCardById(cardId) {
  return playerHand.find((card) => card.id === cardId) || null;
}

function cardRank(card) {
  if (card.isJoker) return 99;
  if (typeof card.value === 'number') return card.value;
  const map = { A: 14, J: 11, Q: 12, K: 13 };
  return map[card.value] || Number(card.value) || 0;
}

function syncLocalHandOrder() {
  const ids = new Set(playerHand.map((card) => card.id));
  const kept = localHandOrder.filter((id) => ids.has(id));
  const keptSet = new Set(kept);
  playerHand.forEach((card) => {
    if (!keptSet.has(card.id)) kept.push(card.id);
  });
  localHandOrder = kept;
}

function getOrderedHand() {
  return localHandOrder.map((id) => getCardById(id)).filter(Boolean);
}

function updateActionButtons() {
  const myTurn = isMyTurn();
  ui.deckButton.disabled = !myTurn;
  ui.discardButton.disabled = !myTurn;
  ui.layDownBtn.classList.toggle('hidden', haveILaidDown());
  ui.layDownBtn.disabled = !myTurn;
}

function createCardElement(card) {
  const btn = document.createElement('button');
  btn.className = `card ${getCardColor(card)}`;
  btn.dataset.cardId = card.id;
  btn.type = 'button';
  btn.draggable = true;

  if (card.isJoker) {
    btn.innerHTML = `<div class="joker-face">${JOKER_FACE}</div>`;
  } else {
    const valueStr = card.value === 10 ? '10' : card.value;
    btn.innerHTML = `
      <div class="card-value">${valueStr}</div>
      <div class="card-suit">${card.suit}</div>
    `;
  }

  btn.addEventListener('click', () => {
    if (!isMyTurn()) return;
    if (mustDrawFirst()) {
      showMessage(MUST_DRAW_MESSAGE, 'error');
      return;
    }
    socket.emit('discard-card', { cardId: card.id });
  });

  btn.addEventListener('dragstart', (event) => {
    draggedCardId = card.id;
    btn.classList.add('dragging');
    ui.playerHand.classList.add('dragging-active');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', card.id);
  });

  btn.addEventListener('dragend', () => {
    btn.classList.remove('dragging');
    ui.playerHand.classList.remove('dragging-active');
    document.querySelectorAll('.card.drag-over').forEach((el) => el.classList.remove('drag-over'));
    draggedCardId = null;
  });

  btn.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    btn.classList.add('drag-over');
  });

  btn.addEventListener('dragleave', () => {
    btn.classList.remove('drag-over');
  });

  btn.addEventListener('drop', (event) => {
    event.preventDefault();
    btn.classList.remove('drag-over');
    if (!draggedCardId || draggedCardId === card.id) return;
    reorderHand(draggedCardId, card.id);
    draggedCardId = null;
  });

  return btn;
}

function reorderHand(fromId, toId) {
  const fromIndex = localHandOrder.indexOf(fromId);
  const toIndex = localHandOrder.indexOf(toId);
  if (fromIndex < 0 || toIndex < 0) return;

  const updated = [...localHandOrder];
  const [moved] = updated.splice(fromIndex, 1);
  updated.splice(toIndex, 0, moved);
  localHandOrder = updated;
  renderHand();
}

function createMiniCard(card) {
  const el = document.createElement('span');
  el.className = `table-card ${getCardColor(card)}`;
  el.textContent = getCardDisplay(card);
  return el;
}

function buildGroupElement(cards, playerId, groupIdx, groupType) {
  const group = document.createElement('div');
  group.className = `laid-group ${groupType === 'trios' ? 'trio' : 'scale'}`;

  cards.forEach((card) => group.appendChild(createMiniCard(card)));

  group.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    group.classList.add('drag-over-group');
  });
  group.addEventListener('dragleave', () => group.classList.remove('drag-over-group'));
  group.addEventListener('drop', (e) => {
    e.preventDefault();
    group.classList.remove('drag-over-group');
    if (!draggedCardId) return;
    if (!isMyTurn()) {
      showMessage('No es tu turno.', 'error');
      return;
    }
    if (!haveILaidDown()) {
      showMessage('Primero debes bajarte.', 'error');
      return;
    }
    socket.emit('add-to-table', {
      cardIds: [draggedCardId],
      groupIndex: groupIdx,
      groupType,
      playerId
    });
  });

  return group;
}

function renderPlayers(room) {
  // Ocultar todos los asientos y mostrar solo los necesarios
  for (let i = 0; i < 4; i++) {
    const seat = document.getElementById(`player-${i}`);
    if (seat) {
      seat.innerHTML = '';
      seat.classList.add('hidden');
    }
  }

  const seatIds = SEAT_MAP[Math.min(Math.max(room.players.length, 1), 4)];

  room.players.forEach((player, index) => {
    const seat = document.getElementById(`player-${seatIds[index]}`);
    if (!seat) return;
    seat.classList.remove('hidden');

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

    if (player.laidDown) {
      const laidBadge = document.createElement('div');
      laidBadge.className = 'laid-badge';
      laidBadge.textContent = '✓ Bajado';
      seat.appendChild(laidBadge);

      const tableData = room.tableCards && room.tableCards[player.id];
      if (tableData) {
        const laidCards = document.createElement('div');
        laidCards.className = 'laid-cards';

        (tableData.trios || []).forEach((trio, idx) => {
          laidCards.appendChild(buildGroupElement(trio, player.id, idx, 'trios'));
        });
        (tableData.scales || []).forEach((scale, idx) => {
          laidCards.appendChild(buildGroupElement(scale, player.id, idx, 'scales'));
        });

        seat.appendChild(laidCards);
      }
    }
  });
}

function renderHand() {
  ui.playerHand.innerHTML = '';
  if (!currentRoom || !playerHand.length) return;

  syncLocalHandOrder();
  getOrderedHand().forEach((card) => {
    ui.playerHand.appendChild(createCardElement(card));
  });
}

function updateStartButton(room) {
  const hasEnoughPlayers = room && room.players && room.players.length >= 2;
  ui.startGameSection.classList.toggle('hidden', !hasEnoughPlayers || room.started);
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
    ui.discardPreview.textContent = getCardDisplay(room.discardTop);
    ui.discardPreview.className = `discard-card ${getCardColor(room.discardTop)}`;
  } else {
    ui.discardPreview.textContent = '';
    ui.discardPreview.className = 'discard-card';
  }

  renderPlayers(room);
  renderHand();
  updateStartButton(room);

  if (room.started) {
    ui.lobbyPanel.classList.add('hidden');
    ui.gamePanel.classList.remove('hidden');
    ui.startGameBtn.classList.add('hidden');
    updateActionButtons();
  } else {
    ui.gamePanel.classList.add('hidden');
    ui.lobbyPanel.classList.remove('hidden');
  }
}

function joinRoomByCode() {
  const roomId = ui.roomCode.value.trim().toUpperCase();
  const name = ui.playerName.value.trim() || 'Jugador';

  if (!roomId) {
    showMessage('Ingresa un código de sala.', 'error');
    return;
  }

  socket.emit('join-room', { roomId, name });
  showMessage('Uniéndote a la sala...', 'success');
}

function isValidTrio(cards) {
  if (cards.length < 3) return false;
  const normal = cards.filter((c) => !c.isJoker);
  if (normal.length === 0) return false;
  return new Set(normal.map((c) => cardRank(c))).size === 1;
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

function validateLaydownDraft() {
  const groups = [...laydownDraft.trios, ...laydownDraft.escalas];
  if (!groups.length) return { valid: false, message: 'Agrega al menos una combinación.' };

  const all = groups.flat();
  if (new Set(all).size !== all.length) {
    return { valid: false, message: 'Una carta no puede estar en dos grupos.' };
  }

  const badTrio = laydownDraft.trios.some((g) => !isValidTrio(g.map(getCardById).filter(Boolean)));
  if (badTrio) return { valid: false, message: 'Hay un trío inválido (mismo número, mínimo 3 cartas).' };

  const badScale = laydownDraft.escalas.some((g) => !isValidScale(g.map(getCardById).filter(Boolean)));
  if (badScale) return { valid: false, message: 'Hay una escala inválida (mismo palo, consecutivas, mínimo 4 cartas).' };

  return { valid: true, message: 'Combinación válida.' };
}

function setLaydownStatus(text, isError = false) {
  ui.layDownStatus.textContent = text;
  ui.layDownStatus.classList.toggle('error', isError);
}

function renderLaydownHand() {
  ui.layDownHand.innerHTML = '';
  const used = new Set([...laydownDraft.trios.flat(), ...laydownDraft.escalas.flat()]);

  getOrderedHand().forEach((card) => {
    if (used.has(card.id)) return;
    const selected = laydownSelection.includes(card.id);
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `mini-card ${getCardColor(card)} ${selected ? 'selected' : ''}`.trim();
    el.textContent = getCardDisplay(card);
    el.addEventListener('click', () => {
      laydownSelection = selected
        ? laydownSelection.filter((id) => id !== card.id)
        : [...laydownSelection, card.id];
      renderLaydownHand();
    });
    ui.layDownHand.appendChild(el);
  });
}

function renderLaydownGroups() {
  const render = (key, container, label) => {
    container.innerHTML = '';
    if (!laydownDraft[key].length) {
      const empty = document.createElement('div');
      empty.className = 'empty-group';
      empty.textContent = `Sin ${label}`;
      container.appendChild(empty);
      return;
    }
    laydownDraft[key].forEach((group, index) => {
      const row = document.createElement('div');
      row.className = 'group-row';
      const pills = document.createElement('div');
      pills.className = 'group-pills';
      pills.textContent = group.map((id) => getCardById(id)).filter(Boolean).map(getCardDisplay).join(' ');
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'tiny-button';
      remove.textContent = 'Quitar';
      remove.addEventListener('click', () => {
        laydownDraft[key] = laydownDraft[key].filter((_, i) => i !== index);
        renderLaydownGroups();
        renderLaydownHand();
      });
      row.appendChild(pills);
      row.appendChild(remove);
      container.appendChild(row);
    });
  };
  render('trios', ui.triosSelection, 'tríos');
  render('escalas', ui.scalesSelection, 'escalas');
}

function openLayDownModal() {
  if (haveILaidDown()) {
    showMessage('Ya te bajaste en esta ronda.', 'error');
    return;
  }
  if (!isMyTurn()) {
    showMessage('No es tu turno.', 'error');
    return;
  }
  if (mustDrawFirst()) {
    showMessage(MUST_DRAW_MESSAGE, 'error');
    return;
  }
  laydownDraft = { trios: [], escalas: [] };
  laydownSelection = [];
  renderLaydownHand();
  renderLaydownGroups();
  setLaydownStatus('Selecciona cartas y agrégalas a Tríos o Escalas.');
  ui.layDownModal.classList.remove('hidden');
}

function closeLayDownModal() {
  ui.layDownModal.classList.add('hidden');
  laydownSelection = [];
  laydownDraft = { trios: [], escalas: [] };
}

function addSelectedToGroup(type) {
  if (!laydownSelection.length) {
    setLaydownStatus('Primero selecciona cartas.', true);
    return;
  }
  const cards = laydownSelection.map(getCardById).filter(Boolean);
  const ok = type === 'trios' ? isValidTrio(cards) : isValidScale(cards);
  if (!ok) {
    setLaydownStatus(
      type === 'trios'
        ? 'Un trío necesita 3+ cartas del mismo número.'
        : 'Una escala necesita 4+ cartas consecutivas del mismo palo.',
      true
    );
    return;
  }
  laydownDraft[type].push([...laydownSelection]);
  laydownSelection = [];
  renderLaydownHand();
  renderLaydownGroups();
  setLaydownStatus('Grupo agregado.');
}

function confirmLayDown() {
  const result = validateLaydownDraft();
  if (!result.valid) {
    setLaydownStatus(result.message, true);
    return;
  }
  socket.emit('lay-down', {
    trios: laydownDraft.trios,
    escalas: laydownDraft.escalas
  });
  closeLayDownModal();
  showMessage('Bajada enviada.', 'success');
}

function bindEvents() {
  ui.createRoomBtn.addEventListener('click', () => {
    const name = ui.playerName.value.trim() || 'Jugador';
    const maxPlayers = Number(ui.playerCount.value) || 4;
    socket.emit('create-room', { name, maxPlayers });
    showMessage('Creando sala...', 'success');
  });

  ui.joinRoomBtn.addEventListener('click', joinRoomByCode);
  ui.joinDirectBtn.addEventListener('click', joinRoomByCode);

  ui.startGameBtn.addEventListener('click', () => {
    if (!currentRoom || currentRoom.players.length < 2) {
      showMessage('Se necesitan al menos 2 jugadores para iniciar.', 'error');
      return;
    }
    socket.emit('start-game');
    showMessage('Iniciando partida...', 'success');
  });

  ui.deckButton.addEventListener('click', () => {
    socket.emit('draw-card', { fromDiscard: false });
  });

  ui.discardButton.addEventListener('click', () => {
    socket.emit('draw-card', { fromDiscard: true });
  });

  ui.layDownBtn.addEventListener('click', openLayDownModal);
  ui.confirmLayDownBtn.addEventListener('click', confirmLayDown);
  ui.cancelLayDownBtn.addEventListener('click', closeLayDownModal);
  document.getElementById('add-trios-btn').addEventListener('click', () => addSelectedToGroup('trios'));
  document.getElementById('add-scales-btn').addEventListener('click', () => addSelectedToGroup('escalas'));

  ui.layDownModal.addEventListener('click', (event) => {
    if (event.target === ui.layDownModal) closeLayDownModal();
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
  syncLocalHandOrder();
  renderHand();
  if (!ui.layDownModal.classList.contains('hidden')) renderLaydownHand();
});

socket.on('round-won', ({ winnerName, nextRound }) => {
  showMessage(`🏆 ${winnerName} ganó la ronda. Comienza la ronda ${nextRound}.`, 'success');
  alert(`🏆 ${winnerName} ganó la ronda.\nComienza la ronda ${nextRound}.`);
});

socket.on('game-over', ({ winnerName, scores }) => {
  const summary = scores.map((s) => `${s.name}: ${s.score}`).join('\n');
  showMessage(`🏆 Fin del juego. Ganador: ${winnerName}`, 'success');
  alert(`🏆 Fin del juego. Ganador: ${winnerName}\n\n${summary}`);
});

socket.on('error-message', (message) => {
  showMessage(message, 'error');
});

socket.on('connect', () => {
  console.log('Conectado al servidor');
});

socket.on('disconnect', () => {
  console.log('Desconectado del servidor');
  showMessage('Conexión perdida', 'error');
});

bindEvents();
showMessage('Listo. Crea o únete a una sala.', 'success');
