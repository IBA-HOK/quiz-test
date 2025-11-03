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
      const llmInterval = (el('llmInterval') && el('llmInterval').value) ? Math.max(3, parseFloat(el('llmInterval').value)) * 1000 : null;
      const llmRevealMs = (el('llmRevealMs') && el('llmRevealMs').value) ? Math.max(500, parseInt(el('llmRevealMs').value, 10)) : null;
      const perChar = (el('perCharSec') && el('perCharSec').value) ? parseFloat(el('perCharSec').value) : 3;
  socket.emit('set-auto-refill', { roomId, threshold, refillCount, topic: genre, difficulty, genre, llmIntervalMs: llmInterval, llmRevealMs, perCharSec: perChar });
      log.innerText = `mode: ${mode} (interval ${s}s, refill ${refillCount} when <=${threshold})`;
    } else {
      socket.emit('start-mode', { roomId, mode });
      log.innerText = `mode: ${mode}`;
    }
    if (mode === 'llm') {
      // ask server to generate using genre/difficulty
  const genre = (el('llmGenre') && el('llmGenre').value) ? el('llmGenre').value : '';
  const difficulty = (el('llmDifficulty') && el('llmDifficulty').value) ? parseInt(el('llmDifficulty').value, 10) : 3;
  const llmInterval = (el('llmInterval') && el('llmInterval').value) ? Math.max(3, parseFloat(el('llmInterval').value)) * 1000 : null;
  const llmRevealMs = (el('llmRevealMs') && el('llmRevealMs').value) ? Math.max(500, parseInt(el('llmRevealMs').value, 10)) : null;
  const perChar = (el('perCharSec') && el('perCharSec').value) ? parseFloat(el('perCharSec').value) : 3;
  const topic = genre || 'general knowledge';
  socket.emit('generate-llm', { roomId, topic, count: 5, difficulty, genre, llmIntervalMs: llmInterval, llmRevealMs, perCharSec: perChar });
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
      const perChar = (el('perCharSec') && el('perCharSec').value) ? parseFloat(el('perCharSec').value) : 3;
      socket.emit('set-auto-refill', { roomId, threshold: (el('refillThreshold') && parseInt(el('refillThreshold').value,10)) || 2, refillCount: (el('refillCount') && parseInt(el('refillCount').value,10)) || 5, topic: genre, difficulty, genre, perCharSec: perChar });
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
  const cancelBtn = el('cancelBuzz');
  const qtext = el('qtext');
  const answerDiv = el('answer');
  const answerInputDiv = el('answerInput');
  const status = el('status');
  const othersTyping = el('othersTyping');
  const typingMap = {}; // playerId -> { name, partial }
  // disable buzzer until game starts
  if (buzzer) buzzer.disabled = true;

  // Typewriter state for gradual question display
  let typewriterTimer = null;
  let typewriterIndex = 0;
  let lastQuestionText = '';
  const DISPLAY_CHAR_MS = 30; // ms per character (adjust for speed)

  function cancelTypewriter() {
    if (typewriterTimer) {
      clearInterval(typewriterTimer);
      typewriterTimer = null;
    }
    typewriterIndex = 0;
    try { qtext.classList.remove('typing'); } catch(e){}
  }

  // startTypewriter: gradually reveal `text`. If timeAllowedMs (ms) is provided,
  // use 80% of that time to display the text (slower). Otherwise fall back to
  // a sensible default. ms per character is clamped to avoid too-fast flicker.
  function startTypewriter(text, timeAllowedMs) {
    cancelTypewriter();
    lastQuestionText = text || '';
    qtext.innerText = '';
    try { qtext.classList.add('typing'); } catch(e){}
    const chars = Array.from(lastQuestionText);
    if (chars.length === 0) return;
    typewriterIndex = 0;

    // If timeAllowedMs provided (in ms), allocate 80% of it to reveal the text.
    // Ensure per-character interval is between MIN_MS_PER_CHAR and MAX_MS_PER_CHAR.
    const MIN_MS_PER_CHAR = 40; // don't go faster than this
    const MAX_MS_PER_CHAR = 600; // don't go slower than this
    let msPerChar;
    if (typeof timeAllowedMs === 'number' && timeAllowedMs > 0) {
      const totalForReveal = Math.max(300, Math.floor(timeAllowedMs * 0.8));
      msPerChar = Math.max(MIN_MS_PER_CHAR, Math.min(MAX_MS_PER_CHAR, Math.floor(totalForReveal / chars.length)));
    } else {
      // no total time known: choose a slow default for nicer pacing
      msPerChar = Math.max(DISPLAY_CHAR_MS, 120);
    }

    typewriterTimer = setInterval(() => {
      if (typewriterIndex >= chars.length) {
        cancelTypewriter();
        return;
      }
      qtext.innerText += chars[typewriterIndex];
      typewriterIndex += 1;
    }, msPerChar);
  }

  // local state for question/timers
  let currentQuestionIndex = null;
  let questionCountdown = null;
  let questionCountdownRemaining = 0;
  let answerCountdown = null;
  let answerCountdownRemaining = 0;
  // lock state set when another player buzzes; prevents question countdowns from restarting
  let lockedUntilReveal = false;
  let lockedBy = null;

  joinBtn.onclick = () => {
    const roomId = roomIdInput.value || 'default-room';
    const name = nameInput.value || 'player';
    socket.emit('join', { roomId, name, role: 'player' });
    status.innerText = `joined ${roomId}`;
  };

  buzzer.onclick = () => {
    const roomId = roomIdInput.value || 'default-room';
    socket.emit('buzz', { roomId });
    status.innerText = '早押し送信中...';
    // prevent spamming
    buzzer.disabled = true;
    // show cancel button so user can undo if they changed their mind
    if (cancelBtn) { cancelBtn.classList.remove('hidden'); }
  };

  if (cancelBtn) {
    cancelBtn.onclick = () => {
      const roomId = roomIdInput.value || 'default-room';
      socket.emit('cancel-buzz', { roomId });
      // optimistic hide; server will broadcast 'buzz-cancelled'
      cancelBtn.classList.add('hidden');
      status.innerText = '早押しを取り消しました';
    };
  }

  // When a question arrives: show text, play TTS, show remaining time countdown and enable buzzer.
  socket.on('question', ({ index, q, timeAllowedMs }) => {
    console.log('client received question', { index, q, timeAllowedMs });
    // If we're locked due to another player's buzzer, ignore incoming question updates until reveal
    if (lockedUntilReveal) {
      // keep status showing who buzzed and avoid restarting countdowns
      if (lockedBy && lockedBy.name) status.innerText = `${lockedBy.name} が早押ししました`;
      return;
    }
  currentQuestionIndex = index;
  // gradually reveal question text (typewriter)
  startTypewriter(q.text || '（問題がありません）');
    if (answerDiv) { answerDiv.style.display = 'none'; answerDiv.innerText = '（回答は非表示）'; }
    // clear previous answer input UI
    if (answerInputDiv) answerInputDiv.innerHTML = '';
    // enable buzzer so players can attempt to buzz (unless locked by another player's buzz)
    if (buzzer) {
      if (!lockedUntilReveal) {
        buzzer.classList.remove('hidden');
        buzzer.disabled = false;
      } else {
        buzzer.classList.add('hidden');
        buzzer.disabled = true;
      }
    }
    // cancel any existing timers
    if (questionCountdown) clearInterval(questionCountdown);
    if (answerCountdown) { clearInterval(answerCountdown); answerCountdown = null; }
    // start countdown that shows remaining time until auto-reveal
    if (timeAllowedMs && timeAllowedMs > 0) {
      questionCountdownRemaining = Math.ceil(timeAllowedMs / 1000);
      status.innerText = `残り ${questionCountdownRemaining} 秒 — 早押しで回答してください`;
      questionCountdown = setInterval(() => {
        questionCountdownRemaining -= 1;
        if (questionCountdownRemaining <= 0) {
          clearInterval(questionCountdown);
          questionCountdown = null;
          status.innerText = '回答受付終了（タイムアウト）';
          if (buzzer) buzzer.disabled = true;
        } else {
          status.innerText = `残り ${questionCountdownRemaining} 秒 — 早押しで回答してください`;
        }
      }, 1000);
    } else {
      status.innerText = '早押しで回答してください';
      if (buzzer) {
        if (!lockedUntilReveal) {
          buzzer.classList.remove('hidden');
          buzzer.disabled = false;
        } else {
          buzzer.classList.add('hidden');
          buzzer.disabled = true;
        }
      }
    }
    // TTS
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
    console.log('client received reveal-answer', { index, answer });
    // clear any timers and input UI
    // If a typewriter is running, cancel and show full text immediately
    cancelTypewriter();
    if (lastQuestionText) qtext.innerText = lastQuestionText;
    if (questionCountdown) { clearInterval(questionCountdown); questionCountdown = null; }
    if (answerCountdown) { clearInterval(answerCountdown); answerCountdown = null; }
    if (answerInputDiv) answerInputDiv.innerHTML = '';
    if (answerDiv) {
      answerDiv.style.display = 'block';
      answerDiv.innerText = `答え: ${answer || '（回答なし）'}`;
    }
    status.innerText = `答え表示: ${answer || '（回答なし）'}`;
    if (buzzer) buzzer.disabled = true;
    // clear any buzzer-lock state so new questions will be accepted
    lockedUntilReveal = false;
    lockedBy = null;
    // make buzzer visible again but disabled until next question
    if (buzzer) { buzzer.classList.remove('hidden'); buzzer.disabled = true; }
    if (cancelBtn) cancelBtn.classList.add('hidden');
  });

  // When reveal occurs, clear/disable the onscreen input UI
  socket.on('reveal-answer', ({ index, answer }) => {
    if (answerInputDiv) answerInputDiv.innerHTML = '';
    if (status) status.innerText = `答え: ${answer || '（回答なし）'}`;
    // clear any buzzer-lock state so new questions will be accepted
    lockedUntilReveal = false;
    lockedBy = null;
    if (buzzer) { buzzer.classList.remove('hidden'); buzzer.disabled = true; }
  });

  // Build answer UI when this player is granted the buzz (only the buzzer sees the input)
  socket.on('buzz-granted', ({ index, answerWindowMs, answerLength, answerHiragana }) => {
    console.log('client received buzz-granted', { index, answerWindowMs, answerLength, answerHiragana });
    if (index !== currentQuestionIndex) return;
    // If this client is the buzzer, clear any global lock
    lockedUntilReveal = false;
    lockedBy = null;
    // stop question countdown
    if (questionCountdown) { clearInterval(questionCountdown); questionCountdown = null; }
  // ensure buzzer is visible for the answering player but disabled to avoid double-press
  if (buzzer) { buzzer.classList.remove('hidden'); buzzer.disabled = true; }
  // show cancel button so the buzzer can undo before typing
  if (cancelBtn) cancelBtn.classList.remove('hidden');
    // show answer UI
    if (!answerInputDiv) return;
    answerInputDiv.innerHTML = '';
    if (!answerLength || answerLength <= 0) return;
    // Build per-character slots and onscreen keyboard (reuse earlier logic)
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
        if (s.textContent) {
          s.textContent = '';
          filled[i] = '';
          current = i;
          renderKeyboardFor(current);
          // notify server of typing change
          try { const roomId = roomIdInput.value || 'default-room'; socket.emit('typing-update', { roomId, index, partial: filled.join('') }); } catch (e) {}
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
          // hide cancel button on first input (user committed to answering)
          if (cancelBtn) cancelBtn.classList.add('hidden');
          // fill and advance
          slots[pos].textContent = ch;
          filled[pos] = ch;
          // notify server of typing change
          try { const roomId = roomIdInput.value || 'default-room'; socket.emit('typing-update', { roomId, index, partial: filled.join('') }); } catch (e) {}
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

    // answer window countdown
    if (answerCountdown) clearInterval(answerCountdown);
    answerCountdownRemaining = Math.ceil((answerWindowMs || 5000) / 1000);
    status.innerText = `回答時間: ${answerCountdownRemaining} 秒`;
    answerCountdown = setInterval(() => {
      answerCountdownRemaining -= 1;
      if (answerCountdownRemaining <= 0) {
        clearInterval(answerCountdown);
        answerCountdown = null;
        status.innerText = '回答受付終了';
        answerInputDiv.innerHTML = '';
        buzzer.disabled = true;
      } else {
        status.innerText = `回答時間: ${answerCountdownRemaining} 秒`;
      }
    }, 1000);

    // start keyboard for pos 0
    renderKeyboardFor(0);
  });

  // render typing info from other players
  function renderTyping() {
    if (!othersTyping) return;
    const lines = [];
    for (const pid of Object.keys(typingMap)) {
      const item = typingMap[pid];
      if (!item) continue;
      if (!item.partial) continue;
      lines.push(`${item.name || '誰か'}: ${item.partial}`);
    }
    othersTyping.innerText = lines.join('\n');
  }

  socket.on('player-typing', ({ playerId, name, index, partial }) => {
    // update map and re-render
    if (!partial) {
      delete typingMap[playerId];
    } else {
      typingMap[playerId] = { name, partial };
    }
    renderTyping();
  });

  // handle answer result for submitting player
  socket.on('answer-result', ({ index, ok, error }) => {
    if (error) {
      if (error === 'locked') status.innerText = '入力は締め切られました';
      else status.innerText = `エラー: ${error}`;
      return;
    }
    if (ok) { status.innerText = '正解！'; }
    else { status.innerText = '不正解。もう一度入力してください。'; }
  });

  socket.on('buzz-locked', ({ playerId, name }) => {
    console.log('client received buzz-locked', { playerId, name });
    // another player has buzzed — disable buzzer and hide answer UI
    if (buzzer) { buzzer.disabled = true; buzzer.classList.add('hidden'); }
    // hide cancel button on other clients
    if (cancelBtn) cancelBtn.classList.add('hidden');
    if (answerInputDiv) answerInputDiv.innerHTML = '';
    // stop question countdown so the status message isn't overwritten
    if (questionCountdown) { clearInterval(questionCountdown); questionCountdown = null; }
    questionCountdownRemaining = 0;
    // stop any speechSynthesis playback to avoid overlap
    try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch(e){}
    // set lock state so subsequent 'question' events don't restart the countdown
    lockedUntilReveal = true;
    lockedBy = { playerId, name };
    status.innerText = `${name} が早押ししました`;
  });
  // When someone cancels their buzz, room should be unlocked again
  socket.on('buzz-cancelled', ({ playerId, name }) => {
    console.log('client received buzz-cancelled', { playerId, name });
    // hide cancel button and re-enable buzzer for everyone
    if (cancelBtn) cancelBtn.classList.add('hidden');
    if (buzzer) { buzzer.classList.remove('hidden'); buzzer.disabled = false; }
    status.innerText = `${name} が早押しを取り消しました`;
  });
  socket.on('buzz-denied', ({ reason }) => {
    status.innerText = `早押しは無効 (${reason})`;
    if (buzzer) buzzer.disabled = true;
  });

  // host receives info about attempts
  socket.on('player-answer', ({ playerId, name, index, answer, ok }) => {
    // only visible to host (but all clients receive by default); client can show brief notice
    console.log('player-answer', name, index, ok);
  });
  socket.on('game-started', ({ started }) => {
    status.innerText = `ゲーム開始: ${started}`;
    if (buzzer) { if (started) buzzer.classList.remove('hidden'); else buzzer.classList.add('hidden'); buzzer.disabled = !started; }
    // If game started but no question yet, update question area to notify players
    if (started) {
      if (qtext) qtext.innerText = 'ゲームが開始されました。出題を待ってください。';
    } else {
      if (qtext) qtext.innerText = 'まだ開始されていません';
    }
  });
}
