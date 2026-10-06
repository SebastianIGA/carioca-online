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

function getCardDisplay(card) {
  if (card.isJoker) return '🂿';
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
  const map = { J: 11, Q: 12, K: 13, A: 14 };
  return map[card.value] || 0;
}

function normalizeCards(cardIds) {
  return cardIds
    .map((id) => getCardById(id))
    .filter(Boolean);
}

function isValidTrio(cardIds) {
  const cards = normalizeCards(cardIds);
  if (cards.length !== 3) return false;
  const values = cards.map((card) => cardRank(card));
  return new Set(values).size === 1;
}

function isValidScale(cardIds) {
  const cards = normalizeCards(cardIds);
  if (cards.length < 3) return false;
  const sorted = [...cards].sort((a, b) => cardRank(a) - cardRank(b));
  const sameSuit = new Set(sorted.map((card) => card.suit)).size === 1;
  if (!sameSuit) return false;
  const values = sorted.map((card) => cardRank(card));
  for (let i = 1; i < values.length; i++) {
    if (values[i] - values[i - 1] !== 1) {
      return false;
    }
  }
  return true;
}

function validateLaydownDraft() {
  const allCards = [...laydownDraft.trios.flat(), ...laydownDraft.escalas.flat()];
  if (allCards.length === 0) return { valid: false, message: 'Debes elegir al menos una combinación.' };
  if (new Set(allCards).size !== allCards.length) return { valid: false, message: 'No puedes repetir la misma carta en dos grupos.' };

  const invalidGroup = [...laydownDraft.trios, ...laydownDraft.escalas].find((group) => {
    if (group.length === 0) return true;
    return !((group.length >= 3) && (
      (group.length === 3 && isValidTrio(group)) ||
      (group.length >= 3 && isValidScale(group))
    ));
  });

  if (invalidGroup) {
    return { valid: false, message: 'Una o más combinaciones no son válidas. Recuerda: tríos = mismo valor, escaleras = mismo palo y consecutivas.' };
  }

  return { valid: true, message: 'Combinación válida.' };
}

function syncLocalHandOrder() {
  const seen = new Set();
  const nextOrder = [];

  localHandOrder.forEach((cardId) => {
    if (playerHand.some((card) => card.id === cardId) && !seen.has(cardId)) {
      seen.add(cardId);
      nextOrder.push(cardId);
    }
  });

  playerHand.forEach((card) => {
    if (!seen.has(card.id)) {
      nextOrder.push(card.id);
    }
  });

  localHandOrder = nextOrder;
}

function createCardElement(card, isPlayable = false, draggable = false, customClass = '') {
  const btn = document.createElement('button');
  btn.className = `card ${getCardColor(card)} ${customClass}`.trim();
  btn.dataset.cardId = card.id;
  btn.type = 'button';
  btn.draggable = draggable;
  btn.style.transition = 'transform 0.15s ease, box-shadow 0.15s ease';

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

  if (draggable) {
    btn.addEventListener('dragstart', (event) => {
      draggedCardId = card.id;
      btn.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      ui.playerHand.classList.add('dragging-active');
    });

    btn.addEventListener('dragend', () => {
      btn.classList.remove('dragging');
      ui.playerHand.classList.remove('dragging-active');
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
  }

  return btn;
}

function renderPlayers(room) {
  for (let i = 0; i < 4; i++) {
    const seat = document.getElementById(`player-${i}`);
    if (!seat) continue;
    seat.innerHTML = '';
    const player = room.players[i];

    if (!player) {
      const empty = document.createElement('div');
      empty.className = 'player-info';
      empty.textContent = 'Vacío';
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
  const isMyTurn = currentRoom && currentRoom.currentPlayer && currentRoom.currentPlayer.id === currentPlayerId;

  if (!currentRoom || !playerHand.length) {
    return;
  }

  const orderedCards = localHandOrder
    .map((cardId) => playerHand.find((card) => card.id === cardId))
    .filter(Boolean);

  const missing = playerHand.filter((card) => !localHandOrder.includes(card.id));
  const finalOrder = [...orderedCards, ...missing];

  finalOrder.forEach((card) => {
    const cardEl = createCardElement(card, isMyTurn, true);
    ui.playerHand.appendChild(cardEl);
  });
}

function reorderHand(fromCardId, toCardId) {
  const fromIndex = localHandOrder.indexOf(fromCardId);
  const toIndex = localHandOrder.indexOf(toCardId);

  if (fromIndex < 0 || toIndex < 0) return;

  const updated = [...localHandOrder];
  const [moved] = updated.splice(fromIndex, 1);
  updated.splice(toIndex, 0, moved);
  localHandOrder = updated;
  renderHand();
}

function updateStartButton(room) {
  const hasEnoughPlayers = room && room.players && room.players.length >= 2;
  if (ui.startGameSection) {
    ui.startGameSection.classList.toggle('hidden', !hasEnoughPlayers || room.started);
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
  updateStartButton(room);

  if (room.started) {
    ui.lobbyPanel.classList.add('hidden');
    ui.gamePanel.classList.remove('hidden');
    if (ui.startGameBtn) ui.startGameBtn.classList.add('hidden');
    if (ui.deckButton) ui.deckButton.disabled = currentRoom.currentPlayer?.id !== currentPlayerId;
    if (ui.discardButton) ui.discardButton.disabled = currentRoom.currentPlayer?.id !== currentPlayerId;
  } else {
    ui.gamePanel.classList.add('hidden');
    ui.lobbyPanel.classList.remove('hidden');
  }
}

function renderLaydownHand() {
  if (!ui.layDownHand) return;
  ui.layDownHand.innerHTML = '';
  if (!playerHand.length) {
    ui.layDownStatus.textContent = 'No hay cartas disponibles para bajar.';
    return;
  }

  playerHand.forEach((card) => {
    const isSelected = laydownSelection.includes(card.id);
    const cardButton = document.createElement('button');
    cardButton.type = 'button';
    cardButton.className = `mini-card ${isSelected ? 'selected' : ''} ${getCardColor(card)}`;
    cardButton.dataset.cardId = card.id;
    cardButton.innerHTML = card.isJoker ? '🂿' : `${card.value}${card.suit}`;
    cardButton.addEventListener('click', () => {
      if (laydownSelection.includes(card.id)) {
        laydownSelection = laydownSelection.filter((id) => id !== card.id);
      } else {
        laydownSelection = [...laydownSelection, card.id];
      }
      renderLaydownHand();
    });
    ui.layDownHand.appendChild(cardButton);
  });
}

function renderLaydownGroups() {
  if (!ui.triosSelection || !ui.scalesSelection) return;

  const renderGroup = (key, label) => {
    const list = key === 'trios' ? ui.triosSelection : ui.scalesSelection;
    list.innerHTML = '';
    const groups = laydownDraft[key];

    if (!groups.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-group';
      empty.textContent = `Sin ${label.toLowerCase()} seleccionados`;
      list.appendChild(empty);
      return;
    }

    groups.forEach((group, index) => {
      const row = document.createElement('div');
      row.className = 'group-row';

      const pills = document.createElement('div');
      pills.className = 'group-pills';
      const cardsText = group.map((cardId) => getCardById(cardId)).filter(Boolean).map((card) => `${card.value}${card.suit}`).join(' ');
      pills.textContent = cardsText || 'Sin cartas';

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'tiny-button';
      removeBtn.textContent = 'Quitar';
      removeBtn.addEventListener('click', () => {
        laydownDraft[key] = laydownDraft[key].filter((_, i) => i !== index);
        renderLaydownGroups();
      });

      row.appendChild(pills);
      row.appendChild(removeBtn);
      list.appendChild(row);
    });
  };

  renderGroup('trios', 'Tríos');
  renderGroup('escalas', 'Escalas');
}

function openLayDownModal() {
  if (!currentRoom || !playerHand.length) {
    showMessage('No tienes cartas para bajar.', 'error');
    return;
  }

  laydownDraft = { trios: [], escalas: [] };
  laydownSelection = [];
  renderLaydownHand();
  renderLaydownGroups();
  if (ui.layDownStatus) ui.layDownStatus.textContent = 'Selecciona cartas y agrega cada grupo a Tríos o Escalas.';
  if (ui.layDownModal) ui.layDownModal.classList.remove('hidden');
}

function closeLayDownModal() {
  if (ui.layDownModal) ui.layDownModal.classList.add('hidden');
  laydownSelection = [];
  laydownDraft = { trios: [], escalas: [] };
}

function addSelectedToGroup(type) {
  if (!ui.layDownStatus) return;
  if (!laydownSelection.length) {
    ui.layDownStatus.textContent = 'Primero selecciona cartas.';
    ui.layDownStatus.classList.add('error');
    return;
  }

  const selected = [...laydownSelection];
  laydownDraft[type].push(selected);
  laydownSelection = [];
  renderLaydownHand();
  renderLaydownGroups();
  ui.layDownStatus.textContent = `Se agregaron ${selected.length} cartas a ${type === 'trios' ? 'Tríos' : 'Escalas'}.`;
  ui.layDownStatus.classList.remove('error');
}

function confirmLayDown() {
  if (!ui.layDownStatus) return;
  const result = validateLaydownDraft();
  if (!result.valid) {
    ui.layDownStatus.textContent = result.message;
    ui.layDownStatus.classList.add('error');
    return;
  }

  const allSelected = [...laydownDraft.trios.flat(), ...laydownDraft.escalas.flat()];
  const remaining = playerHand.filter((card) => !allSelected.includes(card.id));

  const validRemaining = remaining.length >= 0;
  if (!validRemaining) {
    ui.layDownStatus.textContent = 'No puedes bajar cartas que no están en tu mano.';
    ui.layDownStatus.classList.add('error');
    return;
  }

  socket.emit('lay-down', {
    trios: laydownDraft.trios,
    escalas: laydownDraft.escalas,
    selectedCards: allSelected
  });

  closeLayDownModal();
  showMessage('Combinación válida. Esperando turno o confirmación del servidor.', 'success');
}

function bindEvents() {
  ui.createRoomBtn.addEventListener('click', () => {
    const name = ui.playerName.value.trim() || 'Jugador';
    const maxPlayers = Number(ui.playerCount.value) || 4;
    socket.emit('create-room', { name, maxPlayers });
    showMessage('Creando sala...', 'success');
  });

  ui.joinRoomBtn.addEventListener('click', () => {
    joinRoomByCode();
  });

  ui.joinDirectBtn.addEventListener('click', () => {
    joinRoomByCode();
  });

  ui.startGameBtn.addEventListener('click', () => {
    if (!currentRoom || currentRoom.players.length < 2) {
      showMessage('Se necesitan al menos 2 jugadores para iniciar.', 'error');
      return;
    }
    socket.emit('start-game');
    showMessage('Iniciando partida...', 'success');
  });

  if (ui.deckButton) {
    ui.deckButton.addEventListener('click', () => {
      socket.emit('draw-card', { fromDiscard: false });
    });
  }

  if (ui.discardButton) {
    ui.discardButton.addEventListener('click', () => {
      socket.emit('draw-card', { fromDiscard: true });
    });
  }

  if (ui.layDownBtn) {
    ui.layDownBtn.addEventListener('click', () => {
      openLayDownModal();
    });
  }

  if (ui.confirmLayDownBtn) {
    ui.confirmLayDownBtn.addEventListener('click', confirmLayDown);
  }

  if (ui.cancelLayDownBtn) {
    ui.cancelLayDownBtn.addEventListener('click', closeLayDownModal);
  }

  const addTriosBtn = document.getElementById('add-trios-btn');
  const addScalesBtn = document.getElementById('add-scales-btn');

  if (addTriosBtn) {
    addTriosBtn.addEventListener('click', () => addSelectedToGroup('trios'));
  }

  if (addScalesBtn) {
    addScalesBtn.addEventListener('click', () => addSelectedToGroup('escalas'));
  }

  if (ui.layDownModal) {
    ui.layDownModal.addEventListener('click', (event) => {
      if (event.target === ui.layDownModal) closeLayDownModal();
    });
  }
}

socket.on('joined-room', ({ roomId, playerId }) => {
  currentPlayerId = playerId;
  ui.roomCode.value = roomId;
  ui.roomBadge.textContent = roomId;
  showMessage(`Te uniste a la sala ${roomId}`, 'success');
});

socket.on('room-state', (room) => {
  console.log('room-state recibido:', room);
  const previousCards = [...playerHand.map((card) => card.id)];

  currentRoom = room;
  if (room.started && room.currentPlayer && room.currentPlayer.id === currentPlayerId) {
    if (playerHand.length) {
      localHandOrder = [...localHandOrder.filter((id) => room.players.some((p) => p.id === currentPlayerId) || true)];
    }
  }

  renderRoom(room);

  if (!localHandOrder.length && playerHand.length) {
    localHandOrder = playerHand.map((card) => card.id);
  } else {
    syncLocalHandOrder();
  }

  if (previousCards.length !== playerHand.length) {
    const newCards = playerHand.filter((card) => !localHandOrder.includes(card.id));
    if (newCards.length) {
      localHandOrder = [...localHandOrder, ...newCards.map((card) => card.id)];
    }
  }

  renderHand();
});

socket.on('player-hand', ({ hand }) => {
  const previousOrder = [...localHandOrder];
  const previousIds = new Set(playerHand.map((card) => card.id));

  playerHand = hand;

  const nextLocal = [...previousOrder.filter((id) => hand.some((card) => card.id === id))];
  const newCards = hand.filter((card) => !previousIds.has(card.id));

  newCards.forEach((card) => nextLocal.push(card.id));
  localHandOrder = nextLocal;

  renderHand();

  if (ui.layDownModal && !ui.layDownModal.classList.contains('hidden')) {
    renderLaydownHand();
  }
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
