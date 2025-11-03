const socket = io();

function el(id){return document.getElementById(id)}

if (window.location.pathname.endsWith('/admin.html')) {
  // Host/admin logic
  const joinBtn = el('joinBtn');
  const roomIdInput = el('roomId');
  const qrBtn = el('qrBtn');
  const qrDiv = el('qr');
  const modeBtns = Array.from(document.querySelectorAll('.modeBtn'));
  const questionsText = el('questionsText');
  const setQsBtn = el('setQs');
  const nextQBtn = el('nextQ');
  const revealBtn = el('revealAnswer');
  const startGameBtn = el('startGame');
  const log = el('log');

  let adminJoined = false;
  joinBtn.onclick = () => {
    const roomId = roomIdInput.value || 'default-room';
    socket.emit('join', { roomId, role: 'host', name: 'host' });
    adminJoined = true;
    log.innerText = `joined ${roomId}`;
  };

  qrBtn.onclick = async () => {
    const roomId = roomIdInput.value || 'default-room';
    const url = `${location.origin}/?room=${encodeURIComponent(roomId)}`;
    const r = await fetch(`/qr?url=${encodeURIComponent(url)}`);
    const j = await r.json();
    qrDiv.innerHTML = `<img src="${j.dataUrl}" alt="qr"/>`;
  };

  modeBtns.forEach(b => b.onclick = () => {
    const roomId = roomIdInput.value || 'default-room';
    const mode = b.dataset.mode;
    // if selecting auto mode, include interval (seconds)
    if (mode === 'auto') {
      const s = (el('autoInterval') && el('autoInterval').value) ? parseFloat(el('autoInterval').value) : 10;
      const ms = Math.max(1, s) * 1000;
      socket.emit('start-mode', { roomId, mode, intervalMs: ms });
      // tell server to store interval for the room
      socket.emit('set-auto-interval', { roomId, intervalMs: ms });
      // also send auto-refill settings
      const threshold = (el('refillThreshold') && el('refillThreshold').value) ? parseInt(el('refillThreshold').value, 10) : 2;
      const refillCount = (el('refillCount') && el('refillCount').value) ? parseInt(el('refillCount').value, 10) : 5;
      const genre = (el('llmGenre') && el('llmGenre').value) ? el('llmGenre').value : '';
      const difficulty = (el('llmDifficulty') && el('llmDifficulty').value) ? parseInt(el('llmDifficulty').value, 10) : 3;
      socket.emit('set-auto-refill', { roomId, threshold, refillCount, topic: genre, difficulty, genre });
      log.innerText = `mode: ${mode} (interval ${s}s, refill ${refillCount} when <=${threshold})`;
    } else {
      socket.emit('start-mode', { roomId, mode });
      log.innerText = `mode: ${mode}`;
    }
    if (mode === 'llm') {
      // ask server to generate using genre/difficulty
      const genre = (el('llmGenre') && el('llmGenre').value) ? el('llmGenre').value : '';
      const difficulty = (el('llmDifficulty') && el('llmDifficulty').value) ? parseInt(el('llmDifficulty').value, 10) : 3;
      const topic = genre || 'general knowledge';
      socket.emit('generate-llm', { roomId, topic, count: 5, difficulty, genre });
    }
  });

  setQsBtn.onclick = () => {
    const roomId = roomIdInput.value || 'default-room';
    try {
      const arr = JSON.parse(questionsText.value);
      socket.emit('set-questions', { roomId, questions: arr });
      log.innerText = `set ${arr.length} questions`;
    } catch (err) {
      alert('JSON parse error');
    }
  };

  let currentIndex = 0;
  nextQBtn.onclick = () => {
    const roomId = roomIdInput.value || 'default-room';
    socket.emit('next-question', { roomId, index: currentIndex });
    currentIndex++;
  };

  revealBtn.onclick = () => {
    const roomId = roomIdInput.value || 'default-room';
    socket.emit('reveal-answer', { roomId });
    log.innerText = 'revealed answer';
  };

  const forceRefillBtn = el('forceRefill');
  const forceRefillResult = el('forceRefillResult');
  if (forceRefillBtn) {
    forceRefillBtn.onclick = () => {
      const roomId = roomIdInput.value || 'default-room';
      // ensure room has current LLM settings stored, then request force refill
      const genre = (el('llmGenre') && el('llmGenre').value) ? el('llmGenre').value : '';
      const difficulty = (el('llmDifficulty') && el('llmDifficulty').value) ? parseInt(el('llmDifficulty').value, 10) : 3;
      socket.emit('set-auto-refill', { roomId, threshold: (el('refillThreshold') && parseInt(el('refillThreshold').value,10)) || 2, refillCount: (el('refillCount') && parseInt(el('refillCount').value,10)) || 5, topic: genre, difficulty, genre });
      socket.emit('force-refill', { roomId });
      forceRefillResult.innerText = '補充要求送信中...';
    };
  }
  socket.on('force-refill-result', ({ added }) => {
    if (forceRefillResult) forceRefillResult.innerText = `追加された問題数: ${added}`;
  });
  socket.on('force-refill-error', ({ error }) => { if (forceRefillResult) forceRefillResult.innerText = `エラー: ${error}`; });

  if (startGameBtn) {
    startGameBtn.onclick = () => {
      const roomId = roomIdInput.value || 'default-room';
      // ensure host has joined the room before starting
      if (!adminJoined) {
        socket.emit('join', { roomId, role: 'host', name: 'host' });
        adminJoined = true;
      }
      socket.emit('start-game', { roomId });
      log.innerText = 'game start requested';
    };
  }

  socket.on('game-started', ({ started }) => { log.innerText = `game-started: ${started}`; });

  socket.on('room-state', (state) => { log.innerText = JSON.stringify(state, null, 2); });
  socket.on('buzzed', ({ playerId, name }) => { log.innerText = `BUZZ: ${name} (${playerId})`; });

} else {
  // Player UI
  const joinBtn = el('joinBtn');
  const nameInput = el('name');
  const roomIdInput = el('roomId');
  const buzzer = el('buzzer');
  const qtext = el('qtext');
  const answerDiv = el('answer');
  const answerInputDiv = el('answerInput');
  const status = el('status');
  // disable buzzer until game starts
  if (buzzer) buzzer.disabled = true;

  joinBtn.onclick = () => {
    const roomId = roomIdInput.value || 'default-room';
    const name = nameInput.value || 'player';
    socket.emit('join', { roomId, name, role: 'player' });
    status.innerText = `joined ${roomId}`;
  };

  buzzer.onclick = () => {
    const roomId = roomIdInput.value || 'default-room';
    socket.emit('buzz', { roomId });
    status.innerText = 'buzzed';
  };

  socket.on('question', ({ index, q }) => {
    qtext.innerText = q.text || '（問題がありません）';
    if (answerDiv) { answerDiv.style.display = 'none'; answerDiv.innerText = '（回答は非表示）'; }
    // clear previous answer input UI
    if (answerInputDiv) answerInputDiv.innerHTML = '';
    // Use Web Speech API to read question aloud
    try {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(q.text);
        u.lang = 'ja-JP';
        window.speechSynthesis.speak(u);
      }
    } catch (e) { console.warn(e); }
  });

  socket.on('mode-changed', (mode) => { status.innerText = `mode changed: ${mode}`; });
  socket.on('player-buzz', ({ name }) => { status.innerText = `${name} が早押ししました`; });
  socket.on('reveal-answer', ({ index, answer }) => {
    if (answerDiv) {
      answerDiv.style.display = 'block';
      answerDiv.innerText = `答え: ${answer || '（回答なし）'}`;
    }
  });

  // New: when a question is sent, server may include answerLength for hiragana input UI
  socket.on('question', ({ index, q, answerLength, answerHiragana }) => {
    // Note: there are two 'question' listeners above; ensure we handle both by using this handler for input UI
    if (!q) return;
    qtext.innerText = q.text || '（問題がありません）';
    if (answerDiv) { answerDiv.style.display = 'none'; answerDiv.innerText = '（回答は非表示）'; }
    if (!answerInputDiv) return;
    answerInputDiv.innerHTML = '';
    if (!answerLength || answerLength <= 0) return;
    // Build per-character slots and onscreen keyboard
    const n = answerLength;
    const slots = [];
    const filled = Array(n).fill('');
    let current = 0;

    const slotsRow = document.createElement('div');
    slotsRow.style.display = 'flex';
    slotsRow.style.gap = '8px';
    for (let i = 0; i < n; i++) {
      const s = document.createElement('div');
      s.className = 'slot';
      s.style.width = '28px';
      s.style.height = '36px';
      s.style.border = '1px solid #ccc';
      s.style.borderRadius = '4px';
      s.style.display = 'flex';
      s.style.alignItems = 'center';
      s.style.justifyContent = 'center';
      s.style.fontSize = '1.2rem';
      s.textContent = '';
      s.onclick = () => {
        // allow clearing a slot to re-enter
        if (s.textContent) {
          s.textContent = '';
          filled[i] = '';
          current = i;
          renderKeyboardFor(current);
        }
      };
      slots.push(s);
      slotsRow.appendChild(s);
    }
    answerInputDiv.appendChild(slotsRow);

    const kb = document.createElement('div');
    kb.style.marginTop = '8px';
    answerInputDiv.appendChild(kb);

    const HIRAGANA = 'あいうえおかきくけこさしすせそたちつてと\nなにぬねのはひふへほまみむめもやゆよらりるれろわをん';
    const kanaChars = HIRAGANA.replace(/\n/g, '').split('');

    function shuffle(a){ for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }

    function choicesFor(correct) {
      const set = new Set([correct]);
      while (set.size < 5) {
        const c = kanaChars[Math.floor(Math.random()*kanaChars.length)];
        set.add(c);
      }
      return shuffle(Array.from(set));
    }

    function renderKeyboardFor(pos) {
      kb.innerHTML = '';
      if (pos >= n) return;
      const correctChar = answerHiragana && answerHiragana[pos] ? answerHiragana[pos] : null;
      const opts = correctChar ? choicesFor(correctChar) : shuffle(kanaChars.slice()).slice(0,5);
      opts.forEach(ch => {
          const b = document.createElement('button');
        b.textContent = ch;
        b.style.fontSize = '1.2rem';
        b.style.padding = '6px 10px';
        b.style.margin = '4px';
        b.onclick = () => {
          // fill and advance
          slots[pos].textContent = ch;
          filled[pos] = ch;
          // find next empty
          let next = pos+1;
          while (next < n && filled[next]) next++;
          current = next;
          if (current < n) renderKeyboardFor(current);
          else {
            // all filled — submit
            const answerStr = filled.join('');
            const roomId = roomIdInput.value || 'default-room';
            status.innerText = '回答送信中...';
            socket.emit('submit-answer', { roomId, index, answer: answerStr });
          }
        };
        kb.appendChild(b);
      });
    }

    // start keyboard for pos 0
    renderKeyboardFor(0);
  });

  // handle answer result for submitting player
  socket.on('answer-result', ({ index, ok, error }) => {
    if (error) { status.innerText = `エラー: ${error}`; return; }
    if (ok) { status.innerText = '正解！'; }
    else { status.innerText = '不正解。もう一度入力してください。'; }
  });

  // host receives info about attempts
  socket.on('player-answer', ({ playerId, name, index, answer, ok }) => {
    // only visible to host (but all clients receive by default); client can show brief notice
    console.log('player-answer', name, index, ok);
  });
  socket.on('game-started', ({ started }) => {
    status.innerText = `ゲーム開始: ${started}`;
    if (buzzer) buzzer.disabled = !started;
    // If game started but no question yet, update question area to notify players
    if (started) {
      if (qtext) qtext.innerText = 'ゲームが開始されました。出題を待ってください。';
    } else {
      if (qtext) qtext.innerText = 'まだ開始されていません';
    }
  });
}
