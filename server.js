const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Simple in-memory rooms store (for demo/prototyping)
const rooms = {};

app.get('/qr', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url query required' });
  try {
    const dataUrl = await QRCode.toDataURL(url);
    res.json({ dataUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'qr error' });
  }
});

// Debug/test endpoint to trigger LLM generation and report status
app.get('/gen-test', async (req, res) => {
  const topic = req.query.topic || 'general knowledge';
  const count = parseInt(req.query.count || '3', 10);
  try {
    const info = {
      useGemini: useGemini,
      genaiInitialized: !!genaiClient,
      geminiModel: process.env.GEMINI_MODEL || null,
    };
    const difficulty = req.query.difficulty ? parseInt(req.query.difficulty, 10) : 3;
    const genre = req.query.genre || '';
    const questions = await generateQuestionsLLM(topic, count, difficulty, genre);
    return res.json({ info, questions });
  } catch (err) {
    console.error('gen-test error', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

// LLM placeholder: support Gemini (Vertex AI) when USE_GEMINI=1 and Google auth configured.
// Fallback to sample questions when Gemini isn't enabled or call fails.
const useGemini = (process.env.USE_GEMINI === '1' || process.env.USE_GEMINI === 'true');
let genaiClient = null;
if (useGemini) {
  try {
    // Use the @google/genai client (Google GenAI) as recommended in the quickstart
    const { GoogleGenAI } = require('@google/genai');
    // Prefer explicit API key if provided (GEMINI_API_KEY). Otherwise rely on
    // Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS / gcloud auth).
    if (process.env.GEMINI_API_KEY) {
      genaiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      console.log('Google GenAI client initialized with API key');
    } else {
      genaiClient = new GoogleGenAI();
      console.log('Google GenAI client initialized using Application Default Credentials');
    }
  } catch (e) {
    console.warn('Could not initialize Google GenAI client:', e.message || e);
    genaiClient = null;
  }
}

async function generateQuestionsLLM(topic = 'general knowledge', count = 5, difficulty = 3, genre = '') {
  // fallback sample generator
  const fallback = () => Array.from({ length: count }).map((_, i) => ({
    id: `sample-${i + 1}`,
    text: `サンプル問題 ${i + 1}: これは${topic}に関する問題です。`,
    answer: 'さんぷるかいとう'
  }));

  if (!useGemini || !genaiClient) return fallback();

  // Strongly instruct the model to return only valid JSON array matching schema.
  // Difficulty guidance: 1 == elementary school, 10 == university specialist
  const difficultyNum = Math.max(1, Math.min(10, Number(difficulty) || 3));
  const difficultyDesc = `難易度 ${difficultyNum}（1=小学生レベル、10=大学専門科目レベル）`;
  const genreDesc = genre ? `ジャンル: ${genre}` : '';
  const prompt = `以下の形式で返してください。余分な説明は一切不要です。必ずJSON配列のみを返し、他のテキストは含めないでください。\n\n出力形式: [ { "text": "問題文（日本語・短め）", "answer": "正解" }, ... ]\n\n指示: ${genreDesc} ${difficultyDesc} の条件に従い、出題者用の短いクイズ問題を日本語で${count}問生成してください。各問題は1文で、回答も併記してください。回答は必ず一意に定まるように問題を出してください。ハルシネーションの発生は許されないので、確実に事実に基づいた内容にしてください。また、日本語圏で最も有名な呼称を答えとするようにしてください。`;
    // Instruct model to provide answers in hiragana only to support per-character input UI
    const promptWithHiragana = prompt + '\n\n注意: 出力される各オブジェクトの "answer" フィールドは必ずひらがなで記載してください。漢字やカタカナ、ローマ字は使用しないでください。';
    const example = `例: [{ "text": "日本の首都はどこですか？", "answer": "とうきょう" }]`;
  const fullPrompt = `${promptWithHiragana}\n\n${example}`;

  try {
    // Use Google GenAI client to generate content. The JS client supports a convenience
    // method `models.generateContent` which returns a response with text or structured output.
    const modelId = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    let raw = '';
    try {
      // The client examples show calling generateContent with { model, contents }
      const genReq = {
        model: modelId,
        // contents can be a string or array; newer examples use contents: [{ parts: [{ text: ... }] }]
        contents: [{ parts: [{ text: fullPrompt }] }]
      };
      const response = await genaiClient.models.generateContent(genReq);

      // Common response shapes: response.text, response.output, response.candidates, or nested content parts
      if (response && typeof response.text === 'string') {
        raw = response.text;
      } else if (response?.candidates && response.candidates.length) {
        const cand = response.candidates[0];
        raw = (cand?.content && cand.content[0] && cand.content[0].parts && cand.content[0].parts[0] && cand.content[0].parts[0].text) || JSON.stringify(cand);
      } else if (response?.output && response.output.length) {
        // some clients use output -> content -> parts
        const out = response.output[0];
        raw = (out?.content && out.content[0] && out.content[0].parts && out.content[0].parts[0] && out.content[0].parts[0].text) || JSON.stringify(out);
      } else {
        raw = JSON.stringify(response);
      }
    } catch (e) {
      console.warn('GenAI generateContent call failed', e);
      return fallback();
    }

    // Attempt to parse JSON from the model output
    const tryParse = (text) => {
      try {
        const arr = JSON.parse(text);
        if (Array.isArray(arr)) return arr;
      } catch (e) {
        // ignore
      }
      return null;
    };

    // direct parse
    let arr = tryParse(raw);
    if (!arr) {
      // try to extract JSON block between the first '[' and the last ']'
      const start = raw.indexOf('[');
      const end = raw.lastIndexOf(']');
      if (start !== -1 && end !== -1 && end > start) {
        const sub = raw.slice(start, end + 1);
        arr = tryParse(sub);
      }
    }

    if (arr && Array.isArray(arr)) {
      // Normalize answers to hiragana and filter invalid entries
      const processArray = (inArr) => {
        const out = [];
        for (let i = 0; i < inArr.length; i++) {
          const q = inArr[i] || {};
          const text = q.text || q.question || '';
          const rawAns = (q.answer || q.answer_text || q.answerText || '');
          const norm = normalizeToHiragana(rawAns || '');
          if (norm && norm.length > 0) {
            out.push({ id: `llm-${Date.now()}-${i}`, text: text, answer: norm });
          }
        }
        return out;
      };

      let results = processArray(arr);
      // If not enough valid answers, try one retry to get more
      if (results.length < count) {
        console.log('generateQuestionsLLM: insufficient hiragana answers, retrying once');
        try {
          const retryReq = { model: modelId, contents: [{ parts: [{ text: fullPrompt }] }] };
          const retryResp = await genaiClient.models.generateContent(retryReq);
          let raw2 = '';
          if (retryResp && typeof retryResp.text === 'string') raw2 = retryResp.text;
          else if (retryResp?.candidates && retryResp.candidates.length) {
            const cand = retryResp.candidates[0];
            raw2 = (cand?.content && cand.content[0] && cand.content[0].parts && cand.content[0].parts[0] && cand.content[0].parts[0].text) || JSON.stringify(cand);
          } else if (retryResp?.output && retryResp.output.length) {
            const out = retryResp.output[0];
            raw2 = (out?.content && out.content[0] && out.content[0].parts && out.content[0].parts[0] && out.content[0].parts[0].text) || JSON.stringify(out);
          } else raw2 = JSON.stringify(retryResp);

          let arr2 = tryParse(raw2);
          if (!arr2) {
            const s2 = raw2.indexOf('[');
            const e2 = raw2.lastIndexOf(']');
            if (s2 !== -1 && e2 !== -1 && e2 > s2) arr2 = tryParse(raw2.slice(s2, e2 + 1));
          }
          if (arr2 && Array.isArray(arr2)) {
            const more = processArray(arr2);
            results = results.concat(more).slice(0, count);
          }
        } catch (e) {
          console.warn('generateQuestionsLLM retry failed', e);
        }
      }

      if (results && results.length) return results.slice(0, count);
    }

  console.warn('Could not parse GenAI response, falling back to sample questions. Raw output:', raw);
    return fallback();

  } catch (err) {
    console.warn('Gemini generation failed — falling back to sample questions', err);
    return fallback();
  }
}

// Normalize answer: convert Katakana -> Hiragana, keep hiragana and long mark, remove others
function normalizeToHiragana(s) {
  if (!s) return '';
  let out = '';
  for (const ch of String(s)) {
    const code = ch.charCodeAt(0);
    // Katakana range
    if (code >= 0x30A1 && code <= 0x30F6) {
      out += String.fromCharCode(code - 0x60);
    } else if (code >= 0x3041 && code <= 0x3096) {
      // Hiragana
      out += ch;
    } else if (ch === 'ー') {
      out += ch;
    } else {
      // ignore other characters (kanji, ascii, punctuation)
    }
  }
  return out;
}

// Create a sanitized view of a room suitable for emitting to clients.
// Excludes timer objects and full answers to avoid circular refs and leaking answers.
function sanitizeRoom(room) {
  if (!room) return {};
  return {
    host: room.host || null,
    players: room.players || {},
    // expose questions without answers to avoid leaking correct answers and reduce payload size
    questions: Array.isArray(room.questions) ? room.questions.map(q => ({ id: q.id, text: q.text })) : [],
    questionsCount: Array.isArray(room.questions) ? room.questions.length : 0,
    mode: room.mode || null,
    started: !!room.started,
    currentIndex: (typeof room.currentIndex === 'number') ? room.currentIndex : null,
    answerLocked: !!room.answerLocked,
    // expose auto/llm related settings
    autoIntervalMs: room.autoIntervalMs || null,
    autoRefillThreshold: (typeof room.autoRefillThreshold === 'number') ? room.autoRefillThreshold : null,
    autoRefillCount: (typeof room.autoRefillCount === 'number') ? room.autoRefillCount : null,
    llmTopic: room.llmTopic || null,
    llmDifficulty: (typeof room.llmDifficulty !== 'undefined') ? room.llmDifficulty : null,
    llmGenre: room.llmGenre || null,
    llmIntervalMs: room.llmIntervalMs || null,
    llmRevealMs: room.llmRevealMs || null,
    // per-character answer time in seconds (admin-configurable)
    perCharSec: (typeof room.perCharSec === 'number') ? room.perCharSec : (room.perCharSec || 3),
    refilling: !!room.refilling
  };
}

// Helper to check and perform refill for a room
async function maybeRefill(roomId, room) {
  if (!room) return;
  // Only perform auto-refill when room is in LLM mode. Do not refill for machine-read (auto) mode.
  if (room.mode !== 'llm') {
    // debug log to help trace why refill didn't run
    console.log(`maybeRefill: room ${roomId} skipping refill because mode=${room.mode}`);
    return;
  }
  try {
    const remaining = room.questions.length - room.currentIndex;
    const threshold = typeof room.autoRefillThreshold === 'number' ? room.autoRefillThreshold : 2;
    const refillCount = typeof room.autoRefillCount === 'number' ? room.autoRefillCount : 5;
    console.log(`maybeRefill: room ${roomId} remaining=${remaining} threshold=${threshold} refilling=${room.refilling}`);
    if (remaining <= threshold && !room.refilling) {
      console.log(`maybeRefill: room ${roomId} triggering refill of ${refillCount}`);
      room.refilling = true;
      try {
  const topic = room.llmTopic || 'general knowledge';
  const difficulty = room.llmDifficulty || 3;
  const genre = room.llmGenre || '';
  const more = await generateQuestionsLLM(topic, refillCount, difficulty, genre);
        if (Array.isArray(more) && more.length) {
          const before = room.questions.length;
          room.questions = room.questions.concat(more);
          const after = room.questions.length;
          console.log(`maybeRefill: room ${roomId} appended ${after - before} questions (total ${after})`);
          io.to(roomId).emit('room-state', sanitizeRoom(room));
        } else {
          console.log(`maybeRefill: room ${roomId} refill returned no questions`);
        }
      } catch (e) {
        console.warn('maybeRefill failed for room', roomId, e);
      } finally {
        room.refilling = false;
      }
    }
  } catch (e) { console.warn('maybeRefill error', e); }
}

io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  socket.on('join', ({ roomId, name, role }) => {
    socket.join(roomId);
    socket.data = { roomId, name, role };
  rooms[roomId] = rooms[roomId] || { host: null, players: {}, questions: [], mode: null, started: false, currentIndex: null, answerLocked: false };
    if (role === 'host') rooms[roomId].host = socket.id;
    if (role === 'player') rooms[roomId].players[socket.id] = { id: socket.id, name };

  io.to(roomId).emit('room-state', sanitizeRoom(rooms[roomId]));
  });

  socket.on('generate-llm', async ({ roomId, topic, count, difficulty, genre, llmIntervalMs, llmRevealMs, perCharSec }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (topic) room.llmTopic = topic;
    if (typeof difficulty !== 'undefined') room.llmDifficulty = difficulty;
    if (typeof genre !== 'undefined') room.llmGenre = genre;
    if (typeof llmIntervalMs === 'number') room.llmIntervalMs = llmIntervalMs;
    if (typeof llmRevealMs === 'number') room.llmRevealMs = llmRevealMs;
    if (typeof perCharSec === 'number') room.perCharSec = perCharSec;
    const questions = await generateQuestionsLLM(room.llmTopic || topic || 'general knowledge', count || 5, room.llmDifficulty || 3, room.llmGenre || '');
    // when generating new LLM questions as part of changing settings, reset question cursor
    room.questions = questions;
    room.currentIndex = 0;
    room.started = false;
    io.to(roomId).emit('room-state', sanitizeRoom(room));
  });

  socket.on('disconnect', () => {
    const data = socket.data || {};
    const { roomId } = data;
    if (roomId && rooms[roomId]) {
      delete rooms[roomId].players[socket.id];
      if (rooms[roomId].host === socket.id) rooms[roomId].host = null;
      io.to(roomId).emit('room-state', sanitizeRoom(rooms[roomId]));
    }
    console.log('socket disconnected', socket.id);
  });

  socket.on('start-mode', ({ roomId, mode }) => {
    const room = rooms[roomId];
    if (!room) return;
    // clear any existing auto timer when changing mode
    if (room.autoTimer) {
      clearInterval(room.autoTimer);
      room.autoTimer = null;
    }
    // clear any existing LLM timers when changing mode
    if (room.llmTimer) {
      try { clearTimeout(room.llmTimer.questionTimer); } catch(e){}
      try { clearTimeout(room.llmTimer.revealTimer); } catch(e){}
      room.llmTimer = null;
    }
    room.mode = mode;
    io.to(roomId).emit('mode-changed', mode);
  });
    
  socket.on('set-auto-interval', ({ roomId, intervalMs }) => {
    const room = rooms[roomId];
    if (!room) return;
    room.autoIntervalMs = intervalMs;
  io.to(roomId).emit('room-state', sanitizeRoom(room));
  });

  socket.on('set-auto-refill', ({ roomId, threshold, refillCount, topic, difficulty, genre, llmIntervalMs, llmRevealMs, perCharSec }) => {
    const room = rooms[roomId];
    if (!room) return;
    room.autoRefillThreshold = typeof threshold === 'number' ? threshold : (room.autoRefillThreshold || 2);
    room.autoRefillCount = typeof refillCount === 'number' ? refillCount : (room.autoRefillCount || 5);
    if (topic) room.llmTopic = topic;
    if (typeof difficulty !== 'undefined') room.llmDifficulty = difficulty;
    if (typeof genre !== 'undefined') room.llmGenre = genre;
    // If client included llmIntervalMs / llmRevealMs, set them
    if (typeof llmIntervalMs === 'number') room.llmIntervalMs = llmIntervalMs;
    if (typeof llmRevealMs === 'number') room.llmRevealMs = llmRevealMs;
    // per-character answer time (seconds)
    if (typeof perCharSec === 'number') room.perCharSec = perCharSec;

    // If LLM settings changed while in llm mode, clear questions and reset to start
    try {
      if (room.mode === 'llm') {
        room.questions = [];
        room.currentIndex = 0;
        room.started = false;
        // stop any running llm timers
        if (room.llmTimer) {
          clearTimeout(room.llmTimer.questionTimer);
          clearTimeout(room.llmTimer.revealTimer);
          room.llmTimer = null;
        }
      }
    } catch (e) { /* ignore */ }
  io.to(roomId).emit('room-state', sanitizeRoom(room));
  });

  socket.on('start-game', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    // mark started and reset current index
    room.started = true;
    room.currentIndex = (typeof room.currentIndex === 'number') ? room.currentIndex : 0;
    io.to(roomId).emit('game-started', { started: true });
    io.to(roomId).emit('room-state', room);

    // if mode is auto, start auto-advance if questions available
    if (room.mode === 'auto' && Array.isArray(room.questions) && room.questions.length > 0) {
      // default interval 10s
      const interval = room.autoIntervalMs || 10000;
      if (room.autoTimer) clearInterval(room.autoTimer);


      room.autoTimer = setInterval(() => {
        const idx = (typeof room.currentIndex === 'number') ? room.currentIndex : 0;
        const q = room.questions[idx];
        if (!q) {
          // no more questions => stop timer and notify
          clearInterval(room.autoTimer);
          room.autoTimer = null;
          io.to(roomId).emit('auto-finished');
          return;
        }
        room.currentIndex = idx;
          // Do not include the answer when broadcasting to players. Instead send answerLength (hiragana-normalized)
        try {
          const rawAns = q.answer || '';
          const norm = normalizeToHiragana(rawAns);
          const answerLength = Array.from(norm).length;
          const qPublic = { text: q.text };
            // reset responder state for new question
            room.currentResponder = null;
            room.answerLocked = false;
            const timeAllowedMs = interval;
            io.to(roomId).emit('question', { index: idx, q: qPublic, answerLength, answerHiragana: norm, timeAllowedMs });
        } catch (e) {
            room.currentResponder = null;
            room.answerLocked = false;
            const timeAllowedMs = interval;
            io.to(roomId).emit('question', { index: idx, q: { text: q.text }, answerLength: 0, timeAllowedMs });
        }
        room.currentIndex = idx + 1;
        // After sending, check remaining and trigger refill if under threshold
        maybeRefill(roomId, room).catch(e => console.warn('maybeRefill error in timer', e));
      }, interval);
      io.to(roomId).emit('auto-started', { interval });
    }

    // if mode is llm, start LLM auto-send (question -> reveal -> next) using interval
    if (room.mode === 'llm') {
      const interval = room.llmIntervalMs || room.autoIntervalMs || 10000; // time allowed per question (llm-specific or fallback)
      const revealMs = room.llmRevealMs || 3000; // how long to show answer
      // stop existing llm timer if present
      if (room.llmTimer) {
        try { clearTimeout(room.llmTimer.questionTimer); } catch(e){}
        try { clearTimeout(room.llmTimer.revealTimer); } catch(e){}
        room.llmTimer = null;
      }

      // helper to send a question at currentIndex
      const sendQuestionAt = (idx) => {
        const q = room.questions[idx];
        if (!q) return false;
        room.currentIndex = idx;
        // unlock answers for this new question
        room.currentResponder = null;
        room.answerLocked = false;
        try {
          const rawAns = q.answer || '';
          const norm = normalizeToHiragana(rawAns);
          const answerLength = Array.from(norm).length;
          const qPublic = { text: q.text };
          const timeAllowedMs = interval;
          io.to(roomId).emit('question', { index: idx, q: qPublic, answerLength, answerHiragana: norm, timeAllowedMs });
        } catch (e) {
          const timeAllowedMs = interval;
          io.to(roomId).emit('question', { index: idx, q: { text: q.text }, answerLength: 0, timeAllowedMs });
        }
        return true;
      };

      // start flow: send first question (try refill first if none)
      (async () => {
        if (!Array.isArray(room.questions) || room.questions.length === 0) {
          await maybeRefill(roomId, room).catch(e => console.warn('initial maybeRefill for llm start-game failed', e));
        }
        if (!room.questions || room.questions.length === 0) {
          io.to(roomId).emit('auto-finished');
          return;
        }
        // send first
        sendQuestionAt(room.currentIndex || 0);

        // schedule question timeout
        room.llmTimer = {};
        room.llmTimer.questionTimer = setTimeout(function questionTimeout() {
          const idx = room.currentIndex;
          const q = room.questions[idx];
          if (q) {
            room.answerLocked = true;
            io.to(roomId).emit('reveal-answer', { index: idx, answer: q.answer });
          }
          // after reveal delay, advance
          room.llmTimer.revealTimer = setTimeout(async () => {
            const nextIdx = (typeof room.currentIndex === 'number' ? room.currentIndex : 0) + 1;
            // try refill if needed
            await maybeRefill(roomId, room).catch(e => console.warn('maybeRefill error in llm flow', e));
            if (nextIdx >= (room.questions ? room.questions.length : 0)) {
              // no more
              io.to(roomId).emit('auto-finished');
              room.llmTimer = null;
              return;
            }
            sendQuestionAt(nextIdx);
            // schedule next question timeout
            room.llmTimer.questionTimer = setTimeout(questionTimeout, interval);
          }, revealMs);
        }, interval);
        io.to(roomId).emit('auto-started', { mode: 'llm', interval, revealMs });
      })();
    }
  });

  socket.on('set-questions', ({ roomId, questions }) => {
    const room = rooms[roomId];
    if (!room) return;
    room.questions = questions;
    io.to(roomId).emit('room-state', sanitizeRoom(room));
    // if room is LLM mode and started, check refill immediately (in case questions are few)
    try {
      if (room.mode === 'llm' && room.started) {
        maybeRefill(roomId, room).catch(e => console.warn('maybeRefill error on set-questions', e));
      }
    } catch (e) { /* ignore */ }
  });

  socket.on('force-refill', async ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (room.refilling) return socket.emit('error', 'already-refilling');
    room.refilling = true;
    try {
      const count = room.autoRefillCount || 5;
  const topic = room.llmTopic || 'general knowledge';
  const difficulty = room.llmDifficulty || 3;
  const genre = room.llmGenre || '';
  const more = await generateQuestionsLLM(topic, count, difficulty, genre);
      if (Array.isArray(more) && more.length) {
        const before = room.questions.length;
        room.questions = room.questions.concat(more);
        const after = room.questions.length;
        io.to(roomId).emit('room-state', sanitizeRoom(room));
        socket.emit('force-refill-result', { added: after - before });
      } else {
        socket.emit('force-refill-result', { added: 0 });
      }
    } catch (e) {
      console.warn('force-refill failed', e);
      socket.emit('force-refill-error', { error: String(e) });
    } finally {
      room.refilling = false;
    }
  });

  socket.on('next-question', async ({ roomId, index }) => {
    const room = rooms[roomId];
    if (!room) return;
    const idx = (typeof index === 'number') ? index : (typeof room.currentIndex === 'number' ? room.currentIndex : 0);
    let q = room.questions[idx];
    if (!q) {
      // If in LLM mode, try to trigger refill and then re-check
      if (room.mode === 'llm') {
        try {
          await maybeRefill(roomId, room);
        } catch (e) {
          console.warn('maybeRefill error in next-question', e);
        }
        q = room.questions[idx];
        if (!q) return socket.emit('error', 'no-question-after-refill');
      } else {
        return socket.emit('error', 'no-question');
      }
    }
    room.currentIndex = idx;
    // unlock answers for this new question
    room.answerLocked = false;
    try {
      const rawAns = q.answer || '';
      const norm = normalizeToHiragana(rawAns);
      const answerLength = Array.from(norm).length;
      const qPublic = { text: q.text };
  room.answerLocked = false;
  io.to(roomId).emit('question', { index: idx, q: qPublic, answerLength, answerHiragana: norm });
    } catch (e) {
  room.answerLocked = false;
  io.to(roomId).emit('question', { index: idx, q: { text: q.text }, answerLength: 0 });
    }
    // After sending, top-up if in LLM mode
    if (room.mode === 'llm') {
      maybeRefill(roomId, room).catch(e => console.warn('maybeRefill error after next-question', e));
    }
  });

  socket.on('reveal-answer', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    const idx = typeof room.currentIndex === 'number' ? room.currentIndex : null;
    if (idx === null) return socket.emit('error', 'no-current-question');
    const q = room.questions[idx];
    if (!q) return socket.emit('error', 'no-question');
    // Lock answers and broadcast the answer to all clients in the room
    room.answerLocked = true;
    // clear any pending answer timer
    try { if (room.answerTimer) { clearTimeout(room.answerTimer); room.answerTimer = null; } } catch(e){}
    io.to(roomId).emit('reveal-answer', { index: idx, answer: q.answer });
  });

  // Player pressed buzzer
  socket.on('buzz', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    // If someone is already answering, ignore
    if (room.currentResponder) return socket.emit('buzz-denied', { reason: 'busy' });
    const idx = typeof room.currentIndex === 'number' ? room.currentIndex : 0;
    const q = room.questions[idx];
    if (!q) return socket.emit('buzz-denied', { reason: 'no-question' });
    // assign responder
    room.currentResponder = socket.id;
    // Lock others from submitting; allow only responder to submit
    room.answerLocked = false; // we use currentResponder to gate submissions

    // pause auto timers so question timeout doesn't progress while answering
    if (room.autoTimer) {
      try { clearInterval(room.autoTimer); } catch(e){}
      room._pausedAuto = true;
      room._savedAutoInterval = room.autoIntervalMs || room._savedAutoInterval || 10000;
      room.autoTimer = null;
    }
    if (room.llmTimer && room.llmTimer.questionTimer) {
      try { clearTimeout(room.llmTimer.questionTimer); } catch(e){}
    }

  // prepare answer metadata for client UI
  const rawAnsCur = q.answer || '';
  const normCur = normalizeToHiragana(rawAnsCur);
  const answerLengthCur = Array.from(normCur).length;
  // compute answer window based on per-character seconds (default 3s per char)
  const perChar = (typeof room.perCharSec === 'number') ? room.perCharSec : (room.perCharSec ? Number(room.perCharSec) : 3);
  const safePerChar = (isNaN(perChar) || perChar <= 0) ? 3 : perChar;
  const answerWindowMs = Math.max(300, Math.round(safePerChar * answerLengthCur * 1000));
  // debug log
  console.log(`buzz: room=${roomId} socket=${socket.id} name=${socket.data && socket.data.name} idx=${idx} answerLength=${answerLengthCur}`);
  // notify buzzer that they can answer (include answer metadata so client can render keyboard)
  socket.emit('buzz-granted', { index: idx, answerWindowMs, answerLength: answerLengthCur, answerHiragana: normCur });
    // notify others (except the buzzer) that buzzer was accepted and inputs locked
    (async () => {
      try {
        const sockset = await io.in(roomId).allSockets();
        const members = Array.from(sockset || []);
        console.log(`buzz emitting to others in room=${roomId}, members=${members.join(',')}`);
      } catch (e) { console.warn('could not list room sockets', e); }
      try {
        socket.to(roomId).emit('buzz-locked', { playerId: socket.id, name: socket.data.name });
        console.log(`buzz-locked emitted by ${socket.id} to room ${roomId}`);
      } catch (e) { console.warn('failed to emit buzz-locked to others', e); }
    })();

    // start answer timer: when it expires, reveal answer and advance
    try {
      if (room.answerTimer) { clearTimeout(room.answerTimer); room.answerTimer = null; }
      room.answerTimer = setTimeout(async () => {
        // timeout: reveal answer
        try {
          room.answerLocked = true;
          io.to(roomId).emit('reveal-answer', { index: idx, answer: q.answer });
        } catch (e) { console.warn('error revealing after buzzer timeout', e); }
        // after reveal delay, advance to next question and resume timers
        const revealMs = room.llmRevealMs || 3000;
        setTimeout(async () => {
          const nextIdx = (typeof room.currentIndex === 'number' ? room.currentIndex : 0) + 1;
          await maybeRefill(roomId, room).catch(e => console.warn('maybeRefill error after buzzer timeout', e));
          if (nextIdx >= (room.questions ? room.questions.length : 0)) {
            io.to(roomId).emit('auto-finished');
            room.currentResponder = null;
            room.answerTimer = null;
            return;
          }
          // send next question and resume auto/llm timers
          const qn = room.questions[nextIdx];
          room.currentIndex = nextIdx;
          try {
            const norm = normalizeToHiragana(qn.answer || '');
            const answerLength = Array.from(norm).length;
            const qPublic = { text: qn.text };
            room.currentResponder = null;
            room.answerLocked = false;
            const interval = room.llmIntervalMs || room.autoIntervalMs || 10000;
            io.to(roomId).emit('question', { index: nextIdx, q: qPublic, answerLength, answerHiragana: norm, timeAllowedMs: interval });
          } catch (e) {
            room.currentResponder = null;
            room.answerLocked = false;
            const interval = room.llmIntervalMs || room.autoIntervalMs || 10000;
            io.to(roomId).emit('question', { index: nextIdx, q: { text: qn.text }, answerLength: 0, timeAllowedMs: interval });
          }
          // resume auto timer if it was paused
          if (room._pausedAuto) {
            const interval = room._savedAutoInterval || 10000;
            room.autoTimer = setInterval(() => {
              // advance similar to earlier auto timer logic
              const idx2 = (typeof room.currentIndex === 'number') ? room.currentIndex : 0;
              const q2 = room.questions[idx2];
              if (!q2) { clearInterval(room.autoTimer); room.autoTimer = null; io.to(roomId).emit('auto-finished'); return; }
              // send and advance
              try {
                const norm2 = normalizeToHiragana(q2.answer || '');
                const answerLength2 = Array.from(norm2).length;
                const qPublic2 = { text: q2.text };
                room.currentResponder = null;
                room.answerLocked = false;
                io.to(roomId).emit('question', { index: idx2, q: qPublic2, answerLength: answerLength2, answerHiragana: norm2, timeAllowedMs: interval });
              } catch (e) {
                room.currentResponder = null;
                room.answerLocked = false;
                io.to(roomId).emit('question', { index: idx2, q: { text: q2.text }, answerLength: 0, timeAllowedMs: interval });
              }
              room.currentIndex = idx2 + 1;
              maybeRefill(roomId, room).catch(e => console.warn('maybeRefill error in resumed auto timer', e));
            }, interval);
            room._pausedAuto = false;
            room._savedAutoInterval = null;
          }
          room.answerTimer = null;
        }, revealMs);
      }, answerWindowMs);
    } catch (e) { console.warn('error starting answerTimer after buzz', e); }
  });

  // Player cancels their buzz before answering
  socket.on('cancel-buzz', async ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    // only the current responder may cancel
    if (room.currentResponder !== socket.id) return socket.emit('error', 'not-responder');
    try { if (room.answerTimer) { clearTimeout(room.answerTimer); room.answerTimer = null; } } catch(e){}
    // reset responder state and unlock answers
    room.currentResponder = null;
    room.answerLocked = false;
    // notify all clients that the buzz was cancelled
    io.to(roomId).emit('buzz-cancelled', { playerId: socket.id, name: socket.data && socket.data.name });

    // resend the same question so players can buzz again (restart interval)
    const idx = (typeof room.currentIndex === 'number') ? room.currentIndex : 0;
    const q = room.questions[idx];
    if (q) {
      try {
        const norm = normalizeToHiragana(q.answer || '');
        const answerLength = Array.from(norm).length;
        const qPublic = { text: q.text };
        const interval = room.llmIntervalMs || room.autoIntervalMs || 10000;
        io.to(roomId).emit('question', { index: idx, q: qPublic, answerLength, answerHiragana: norm, timeAllowedMs: interval });
      } catch (e) {
        const interval = room.llmIntervalMs || room.autoIntervalMs || 10000;
        io.to(roomId).emit('question', { index: idx, q: { text: q.text }, answerLength: 0, timeAllowedMs: interval });
      }
    }

    // resume auto timer if it was paused
    if (room._pausedAuto) {
      const interval = room._savedAutoInterval || 10000;
      room.autoTimer = setInterval(() => {
        const idx2 = (typeof room.currentIndex === 'number') ? room.currentIndex : 0;
        const q2 = room.questions[idx2];
        if (!q2) { clearInterval(room.autoTimer); room.autoTimer = null; io.to(roomId).emit('auto-finished'); return; }
        try {
          const norm2 = normalizeToHiragana(q2.answer || '');
          const answerLength2 = Array.from(norm2).length;
          const qPublic2 = { text: q2.text };
          room.currentResponder = null;
          room.answerLocked = false;
          io.to(roomId).emit('question', { index: idx2, q: qPublic2, answerLength: answerLength2, answerHiragana: norm2, timeAllowedMs: interval });
        } catch (e) {
          room.currentResponder = null;
          room.answerLocked = false;
          io.to(roomId).emit('question', { index: idx2, q: { text: q2.text }, answerLength: 0, timeAllowedMs: interval });
        }
        room.currentIndex = idx2 + 1;
        maybeRefill(roomId, room).catch(e => console.warn('maybeRefill error in resumed auto timer', e));
      }, interval);
      room._pausedAuto = false;
      room._savedAutoInterval = null;
    }
  });

  // Player typing updates while composing per-character answer
  // payload: { roomId, index, partial }
  socket.on('typing-update', ({ roomId, index, partial }) => {
    try {
      const room = rooms[roomId];
      if (!room) return;
      // sanitize inputs a little
      const idx = (typeof index === 'number') ? index : (typeof room.currentIndex === 'number' ? room.currentIndex : 0);
      const text = (typeof partial === 'string') ? partial : String(partial || '');
      // Broadcast to others in the room (exclude sender)
      socket.to(roomId).emit('player-typing', { playerId: socket.id, name: socket.data && socket.data.name, index: idx, partial: text });
    } catch (e) {
      console.warn('typing-update handler error', e);
    }
  });

  // Player submits an answer (assembled hiragana string)
  socket.on('submit-answer', ({ roomId, index, answer }) => {
    const room = rooms[roomId];
    if (!room) return;
    // Only the current responder may submit an answer when buzzer flow is active
    if (room.currentResponder && room.currentResponder !== socket.id) return socket.emit('answer-result', { index, ok: false, error: 'not-your-turn' });
    // reject submissions if answers are locked (reveal in progress)
    if (room.answerLocked) return socket.emit('answer-result', { index, ok: false, error: 'locked' });
    const q = room.questions[index];
    if (!q) return socket.emit('answer-result', { index, ok: false, error: 'no-question' });
    const expected = normalizeToHiragana(q.answer || '');
    const given = normalizeToHiragana(answer || '');
    const ok = expected === given && expected.length > 0;
    // inform submitting player
    socket.emit('answer-result', { index, ok });
    // inform host about who answered and whether correct
    if (room.host) {
      io.to(room.host).emit('player-answer', { playerId: socket.id, name: socket.data.name, index, answer: given, ok });
    }
    // broadcast to room that player attempted (without revealing correctness to others)
    io.to(roomId).emit('player-attempt', { playerId: socket.id, name: socket.data.name, index });
    // If correct and room is in llm auto mode, reveal answer and advance after reveal delay
    // Regardless of correct or not, if this was a buzzer response, handle advancing/resume
    const wasBuzzer = (room.currentResponder === socket.id);
    if (wasBuzzer) {
      // clear any answer timer
      try { if (room.answerTimer) { clearTimeout(room.answerTimer); room.answerTimer = null; } } catch(e){}
      // reveal now (lock answers)
      room.answerLocked = true;
      io.to(roomId).emit('reveal-answer', { index, answer: q.answer });
      // reset currentResponder
      room.currentResponder = null;
      // schedule advance after revealMs
      const revealMs = room.llmRevealMs || 3000;
      setTimeout(async () => {
        const nextIdx = (typeof room.currentIndex === 'number' ? room.currentIndex : 0) + 1;
        await maybeRefill(roomId, room).catch(e => console.warn('maybeRefill error after buzzer answer', e));
        if (nextIdx >= (room.questions ? room.questions.length : 0)) {
          io.to(roomId).emit('auto-finished');
          room.llmTimer = null;
          return;
        }
        // send next question
        const qn = room.questions[nextIdx];
        room.currentIndex = nextIdx;
        try {
          const norm = normalizeToHiragana(qn.answer || '');
          const answerLength = Array.from(norm).length;
          const qPublic = { text: qn.text };
          room.answerLocked = false;
          const interval = room.llmIntervalMs || room.autoIntervalMs || 10000;
          io.to(roomId).emit('question', { index: nextIdx, q: qPublic, answerLength, answerHiragana: norm, timeAllowedMs: interval });
        } catch (e) {
          room.answerLocked = false;
          const interval = room.llmIntervalMs || room.autoIntervalMs || 10000;
          io.to(roomId).emit('question', { index: nextIdx, q: { text: qn.text }, answerLength: 0, timeAllowedMs: interval });
        }
        // resume auto timer if it was paused
        if (room._pausedAuto) {
          const interval = room._savedAutoInterval || 10000;
          room.autoTimer = setInterval(() => {
            const idx2 = (typeof room.currentIndex === 'number') ? room.currentIndex : 0;
            const q2 = room.questions[idx2];
            if (!q2) { clearInterval(room.autoTimer); room.autoTimer = null; io.to(roomId).emit('auto-finished'); return; }
            try {
              const norm2 = normalizeToHiragana(q2.answer || '');
              const answerLength2 = Array.from(norm2).length;
              const qPublic2 = { text: q2.text };
              room.answerLocked = false;
              io.to(roomId).emit('question', { index: idx2, q: qPublic2, answerLength: answerLength2, answerHiragana: norm2, timeAllowedMs: interval });
            } catch (e) {
              room.answerLocked = false;
              io.to(roomId).emit('question', { index: idx2, q: { text: q2.text }, answerLength: 0, timeAllowedMs: interval });
            }
            room.currentIndex = idx2 + 1;
            maybeRefill(roomId, room).catch(e => console.warn('maybeRefill error in resumed auto timer', e));
          }, interval);
          room._pausedAuto = false;
          room._savedAutoInterval = null;
        }
      }, revealMs);
    }

    // previous LLM auto behavior (when correct) — if not buzzer flow and correct in llm mode, perform the old flow
    if (!wasBuzzer && ok && room.mode === 'llm') {
      try {
        // clear existing question timer
        if (room.llmTimer && room.llmTimer.questionTimer) {
          clearTimeout(room.llmTimer.questionTimer);
        }
  // reveal now (lock answers)
  room.answerLocked = true;
  io.to(roomId).emit('reveal-answer', { index, answer: q.answer });
        const revealMs = room.llmRevealMs || 3000;
        // schedule advance
        if (!room.llmTimer) room.llmTimer = {};
        room.llmTimer.revealTimer = setTimeout(async () => {
          const nextIdx = (typeof room.currentIndex === 'number' ? room.currentIndex : 0) + 1;
          await maybeRefill(roomId, room).catch(e => console.warn('maybeRefill error after correct answer', e));
          if (nextIdx >= (room.questions ? room.questions.length : 0)) {
            io.to(roomId).emit('auto-finished');
            room.llmTimer = null;
            return;
          }
          // send next question
          const qn = room.questions[nextIdx];
          room.currentIndex = nextIdx;
          try {
            const norm = normalizeToHiragana(qn.answer || '');
            const answerLength = Array.from(norm).length;
            const qPublic = { text: qn.text };
            room.answerLocked = false;
            io.to(roomId).emit('question', { index: nextIdx, q: qPublic, answerLength, answerHiragana: norm });
          } catch (e) {
            room.answerLocked = false;
            io.to(roomId).emit('question', { index: nextIdx, q: { text: qn.text }, answerLength: 0 });
          }
          // restart question timer
          const interval = room.llmIntervalMs || room.autoIntervalMs || 10000;
          room.llmTimer.questionTimer = setTimeout(function questionTimeout() {
            const idx2 = room.currentIndex;
            const q2 = room.questions[idx2];
            if (q2) {
              room.answerLocked = true;
              io.to(roomId).emit('reveal-answer', { index: idx2, answer: q2.answer });
            }
            room.llmTimer.revealTimer = setTimeout(async () => {
              const nextIdx2 = (typeof room.currentIndex === 'number' ? room.currentIndex : 0) + 1;
              await maybeRefill(roomId, room).catch(e => console.warn('maybeRefill error in llm flow after scheduled reveal', e));
              if (nextIdx2 >= (room.questions ? room.questions.length : 0)) {
                io.to(roomId).emit('auto-finished');
                room.llmTimer = null;
                return;
              }
              // send subsequent
              const nextQ = room.questions[nextIdx2];
              room.currentIndex = nextIdx2;
              try {
                const norm2 = normalizeToHiragana(nextQ.answer || '');
                const answerLength2 = Array.from(norm2).length;
                room.answerLocked = false;
                io.to(roomId).emit('question', { index: nextIdx2, q: { text: nextQ.text }, answerLength: answerLength2, answerHiragana: norm2 });
              } catch (err) {
                room.answerLocked = false;
                io.to(roomId).emit('question', { index: nextIdx2, q: { text: nextQ.text }, answerLength: 0 });
              }
              // schedule next question timeout recursively
              room.llmTimer.questionTimer = setTimeout(questionTimeout, interval);
            }, revealMs);
          }, interval);
        }, revealMs);
      } catch (e) { console.warn('error advancing after correct answer', e); }
    }
  });

  
});

server.listen(PORT, () => {
  console.log(`Quiz server running on http://localhost:${PORT}`);
});


