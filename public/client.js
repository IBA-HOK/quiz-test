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
  const currentQuestionDiv = el('currentQuestion');
  const currentQuestionText = el('currentQuestionText');
  const currentQuestionAnswer = el('currentQuestionAnswer');
  const currentQuestionSources = el('currentQuestionSources');

  let adminJoined = false;
  joinBtn.onclick = () => {
    const roomId = roomIdInput.value || 'default-room';
    socket.emit('join', { roomId, role: 'host', name: 'host' });
    adminJoined = true;
    log.innerText = `joined ${roomId}`;
    
    // 管理コントロールを表示
    const adminControls = el('adminControls');
    if (adminControls) {
      adminControls.classList.remove('hidden');
    }
    
    // ボタンを無効化または変更
    joinBtn.disabled = true;
    joinBtn.textContent = '管理中...';
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
      const enableGrounding = (el('enableGrounding') && el('enableGrounding').checked) !== false;
  socket.emit('set-auto-refill', { roomId, threshold, refillCount, topic: genre, difficulty, genre, llmIntervalMs: llmInterval, llmRevealMs, perCharSec: perChar, enableGrounding });
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
  const enableGrounding = (el('enableGrounding') && el('enableGrounding').checked) !== false;
  const topic = genre || 'general knowledge';
  socket.emit('generate-llm', { roomId, topic, count: 5, difficulty, genre, llmIntervalMs: llmInterval, llmRevealMs, perCharSec: perChar, enableGrounding });
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
      const enableGrounding = (el('enableGrounding') && el('enableGrounding').checked) !== false;
      socket.emit('set-auto-refill', { roomId, threshold: (el('refillThreshold') && parseInt(el('refillThreshold').value,10)) || 2, refillCount: (el('refillCount') && parseInt(el('refillCount').value,10)) || 5, topic: genre, difficulty, genre, perCharSec: perChar, enableGrounding });
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

  const restartGameBtn = el('restartGame');
  const restartResult = el('restartResult');
  if (restartGameBtn) {
    restartGameBtn.onclick = () => {
      const roomId = roomIdInput.value || 'default-room';
      if (!adminJoined) {
        socket.emit('join', { roomId, role: 'host', name: 'host' });
        adminJoined = true;
      }
      
      // LLMオプションを読み取る
      const genre = (el('llmGenre') && el('llmGenre').value) ? el('llmGenre').value : '';
      const difficulty = (el('llmDifficulty') && el('llmDifficulty').value) ? parseInt(el('llmDifficulty').value, 10) : 3;
      const refillCount = (el('refillCount') && el('refillCount').value) ? parseInt(el('refillCount').value, 10) : 5;
      const llmInterval = (el('llmInterval') && el('llmInterval').value) ? Math.max(3, parseFloat(el('llmInterval').value)) * 1000 : null;
      const llmRevealMs = (el('llmRevealMs') && el('llmRevealMs').value) ? Math.max(500, parseInt(el('llmRevealMs').value, 10)) : null;
      const perChar = (el('perCharSec') && el('perCharSec').value) ? parseFloat(el('perCharSec').value) : 3;
      const threshold = (el('refillThreshold') && el('refillThreshold').value) ? parseInt(el('refillThreshold').value, 10) : 2;
      const enableGrounding = (el('enableGrounding') && el('enableGrounding').checked) !== false;
      
      const topic = genre || 'general knowledge';
      
      socket.emit('restart-game', { 
        roomId, 
        topic, 
        count: refillCount,
        difficulty, 
        genre,
        llmIntervalMs: llmInterval,
        llmRevealMs,
        perCharSec: perChar,
        threshold,
        enableGrounding
      });
      if (restartResult) restartResult.innerText = '問題更新中...';
      log.innerText = 'restart-game requested with current LLM options';
    };
  }
  socket.on('restart-game-result', ({ success, questionsCount, error }) => {
    if (restartResult) {
      if (success) {
        restartResult.innerText = `✓ 問題更新完了！問題数: ${questionsCount}`;
        setTimeout(() => { restartResult.innerText = ''; }, 3000);
      } else {
        restartResult.innerText = `✗ エラー: ${error}`;
      }
    }
    if (log) log.innerText = `restart-game result: success=${success}, count=${questionsCount}`;
  });

  // Document upload and question generation
  const documentUpload = el('documentUpload');
  const generateFromDocBtn = el('generateFromDoc');
  const docGenResult = el('docGenResult');

  if (generateFromDocBtn) {
    generateFromDocBtn.onclick = async () => {
      if (!documentUpload || !documentUpload.files || documentUpload.files.length === 0) {
        if (docGenResult) docGenResult.innerText = 'ファイルを選択してください';
        return;
      }

      const file = documentUpload.files[0];
      const roomId = roomIdInput.value || 'default-room';
      
      // Ensure host has joined the room
      if (!adminJoined) {
        socket.emit('join', { roomId, role: 'host', name: 'host' });
        adminJoined = true;
      }

      if (docGenResult) docGenResult.innerText = 'アップロード中...';
      generateFromDocBtn.disabled = true;

      try {
        // Upload document
        const formData = new FormData();
        formData.append('document', file);

        const uploadRes = await fetch('/api/upload-document', {
          method: 'POST',
          body: formData
        });

        if (!uploadRes.ok) {
          const errData = await uploadRes.json();
          throw new Error(errData.error || 'アップロード失敗');
        }

        const uploadData = await uploadRes.json();
        if (docGenResult) docGenResult.innerText = `解析完了 (${uploadData.length}文字) - 問題生成中...`;

        // Generate questions from document text
        const count = (el('docQuestionCount') && el('docQuestionCount').value) ? parseInt(el('docQuestionCount').value, 10) : 5;
        const difficulty = (el('docDifficulty') && el('docDifficulty').value) ? parseInt(el('docDifficulty').value, 10) : 3;
        const genre = (el('docGenre') && el('docGenre').value) ? el('docGenre').value : '';

        const genRes = await fetch('/api/generate-from-document', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            documentText: uploadData.text,
            count: count,
            difficulty: difficulty,
            genre: genre
          })
        });

        if (!genRes.ok) {
          const errData = await genRes.json();
          throw new Error(errData.error || '問題生成失敗');
        }

        const genData = await genRes.json();
        
        if (!genData.questions || genData.questions.length === 0) {
          throw new Error('問題が生成されませんでした');
        }

        // Set questions to the room
        socket.emit('set-questions', { roomId, questions: genData.questions });
        
        if (docGenResult) {
          docGenResult.innerText = `✓ ${genData.questions.length}問を生成しました！`;
          setTimeout(() => { docGenResult.innerText = ''; }, 3000);
        }
        
        // Update questions text area
        if (questionsText) {
          questionsText.value = JSON.stringify(genData.questions, null, 2);
        }

        if (log) log.innerText = `Generated ${genData.questions.length} questions from document`;

      } catch (err) {
        console.error('Document generation error:', err);
        if (docGenResult) docGenResult.innerText = `✗ エラー: ${err.message}`;
      } finally {
        generateFromDocBtn.disabled = false;
      }
    };
  }

  socket.on('game-started', ({ started }) => { log.innerText = `game-started: ${started}`; });

  socket.on('room-state', (state) => { 
    log.innerText = JSON.stringify(state, null, 2);
    
    // Update LLM status display
    const llmStatus = el('llmStatus');
    if (llmStatus) {
      if (state.mode === 'llm' && state.llmPaused) {
        llmStatus.style.display = 'block';
      } else {
        llmStatus.style.display = 'none';
      }
    }
    // Show generation indicator when server-side is refilling/generating
    const genEl = el('generating');
    if (genEl) {
      if (state.refilling) {
        genEl.style.display = 'block';
      } else {
        genEl.style.display = 'none';
      }
    }
  });
  
  socket.on('llm-paused', ({ reason }) => {
    if (log) log.innerText = `LLM paused: ${reason}`;
    const llmStatus = el('llmStatus');
    if (llmStatus) llmStatus.style.display = 'block';
  });
  
  socket.on('llm-resumed', ({ reason }) => {
    if (log) log.innerText = `LLM resumed: ${reason}`;
    const llmStatus = el('llmStatus');
    if (llmStatus) llmStatus.style.display = 'none';
  });
  
  socket.on('buzzed', ({ playerId, name }) => { log.innerText = `BUZZ: ${name} (${playerId})`; });
  
  // Show notification for player answers (admin only)
  socket.on('player-answer', ({ playerId, name, index, answer, ok }) => {
    console.log('player-answer (admin)', name, index, ok);
    const notification = document.createElement('div');
    notification.className = ok ? 'player-correct-notification' : 'player-incorrect-notification';
    notification.innerText = ok ? `✓ ${name} 正解！` : `✗ ${name} 不正解`;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
  });
  
  // Display current question with sources for admin
  socket.on('question', ({ index, q, timeAllowedMs }) => {
    if (currentQuestionDiv) {
      currentQuestionDiv.style.display = 'block';
    }
    if (currentQuestionText) {
      currentQuestionText.innerText = `問題 ${index + 1}: ${q.text || ''}`;
    }
    if (currentQuestionAnswer) {
      currentQuestionAnswer.innerText = `正解: ${q.answer || ''}`;
    }
    if (currentQuestionSources && q.sources && q.sources.length > 0) {
      currentQuestionSources.innerHTML = '<strong>出典:</strong><br>' + 
        q.sources.map((src, idx) => 
          `${idx + 1}. <a href="${src.uri}" target="_blank" rel="noopener noreferrer" style="color:#1976d2">${src.title}</a>`
        ).join('<br>');
    } else if (currentQuestionSources) {
      currentQuestionSources.innerHTML = '';
    }
  });

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
  const sourcesDiv = el('sources');
  const sourcesList = el('sourcesList');
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
    
    // Display sources if available
    if (sourcesDiv && sourcesList && q.sources && q.sources.length > 0) {
      sourcesList.innerHTML = q.sources.map((src, idx) => 
        `<div style="margin-top:4px"><a href="${src.uri}" target="_blank" rel="noopener noreferrer" style="color:#1976d2">${idx + 1}. ${src.title}</a></div>`
      ).join('');
      sourcesDiv.style.display = 'block';
    } else if (sourcesDiv) {
      sourcesDiv.style.display = 'none';
    }
    
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
  // Show correct/incorrect effects
  function showCorrectEffect() {
    // Add effect text
    const effect = document.createElement('div');
    effect.className = 'correct-effect';
    effect.innerText = '⭕ 正解！';
    document.body.appendChild(effect);
    setTimeout(() => effect.remove(), 1500);
    
    // Flash background
    document.body.classList.add('correct-flash');
    setTimeout(() => document.body.classList.remove('correct-flash'), 800);
    
    // Create confetti
    const colors = ['#4CAF50', '#8BC34A', '#CDDC39', '#FFEB3B', '#FFC107', '#FF9800'];
    for (let i = 0; i < 50; i++) {
      setTimeout(() => {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.style.left = Math.random() * 100 + '%';
        confetti.style.top = '-20px';
        confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        confetti.style.animationDelay = (Math.random() * 0.3) + 's';
        document.body.appendChild(confetti);
        setTimeout(() => confetti.remove(), 2000);
      }, i * 20);
    }
    
    // Play sound (optional - using Web Audio API)
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.frequency.value = 523.25; // C5
      oscillator.type = 'sine';
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.5);
      
      // Add second note
      const osc2 = audioContext.createOscillator();
      const gain2 = audioContext.createGain();
      osc2.connect(gain2);
      gain2.connect(audioContext.destination);
      osc2.frequency.value = 659.25; // E5
      osc2.type = 'sine';
      gain2.gain.setValueAtTime(0.3, audioContext.currentTime + 0.15);
      gain2.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.65);
      osc2.start(audioContext.currentTime + 0.15);
      osc2.stop(audioContext.currentTime + 0.65);
    } catch (e) {
      console.warn('Audio playback failed', e);
    }
  }
  
  function showIncorrectEffect() {
    // Add effect text
    const effect = document.createElement('div');
    effect.className = 'incorrect-effect';
    effect.innerText = '✕ 不正解';
    document.body.appendChild(effect);
    setTimeout(() => effect.remove(), 1000);
    
    // Flash background
    document.body.classList.add('incorrect-flash');
    setTimeout(() => document.body.classList.remove('incorrect-flash'), 800);
    
    // Play sound (optional)
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.frequency.value = 200; // Low note
      oscillator.type = 'sawtooth';
      gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.3);
    } catch (e) {
      console.warn('Audio playback failed', e);
    }
  }

  socket.on('answer-result', ({ index, ok, error }) => {
    if (error) {
      if (error === 'locked') status.innerText = '入力は締め切られました';
      else status.innerText = `エラー: ${error}`;
      return;
    }
    if (ok) { 
      status.innerText = '正解！';
      showCorrectEffect();
    } else { 
      status.innerText = '不正解。もう一度入力してください。';
      showIncorrectEffect();
    }
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
    // stop typewriter effect - cancel animation and show full text immediately
    cancelTypewriter();
    if (lastQuestionText) qtext.innerText = lastQuestionText;
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
    // Show brief status update for other players
    console.log('player-answer', name, index, ok);
    // Don't show notification for your own answer (that's handled by answer-result)
    if (socket.id !== playerId && status) {
      const prevStatus = status.innerText;
      status.innerText = ok ? `${name} さんが正解しました！` : `${name} さんは不正解でした`;
      setTimeout(() => {
        // Restore previous status if it hasn't changed
        if (status.innerText.includes(name)) {
          status.innerText = prevStatus;
        }
      }, 2000);
    }
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

  // Update generation indicator from room state (server emits room-state periodically)
  socket.on('room-state', (state) => {
    const genEl = el('generating');
    if (genEl) {
      if (state && state.refilling) genEl.style.display = 'block';
      else genEl.style.display = 'none';
    }
  });
}
