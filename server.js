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
  const prompt = `以下の形式で返してください。余分な説明は一切不要です。必ずJSON配列のみを返し、他のテキストは含めないでください。\n\n出力形式: [ { "text": "問題文（日本語・短め）", "answer": "正解" }, ... ]\n\n指示: ${genreDesc} ${difficultyDesc} の条件に従い、出題者用の短いクイズ問題を日本語で${count}問生成してください。各問題は1文で、回答も併記してください。回答は必ず一意に定まるように問題を出してください。ハルシネーションの発生は許されないので、確実に事実に基づいた内容にしてください。`;
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
      return arr.map((q, i) => ({ id: `llm-${Date.now()}-${i}`, text: q.text || q.question || '', answer: q.answer || '' }));
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
          io.to(roomId).emit('room-state', room);
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
    rooms[roomId] = rooms[roomId] || { host: null, players: {}, questions: [], mode: null, started: false, currentIndex: null };
    if (role === 'host') rooms[roomId].host = socket.id;
    if (role === 'player') rooms[roomId].players[socket.id] = { id: socket.id, name };

    io.to(roomId).emit('room-state', rooms[roomId]);
  });

  socket.on('start-mode', ({ roomId, mode }) => {
    const room = rooms[roomId];
    if (!room) return;
    // clear any existing auto timer when changing mode
    if (room.autoTimer) {
      clearInterval(room.autoTimer);
      room.autoTimer = null;
    }
    room.mode = mode;
    io.to(roomId).emit('mode-changed', mode);
  });
    
  socket.on('set-auto-interval', ({ roomId, intervalMs }) => {
    const room = rooms[roomId];
    if (!room) return;
    room.autoIntervalMs = intervalMs;
    io.to(roomId).emit('room-state', room);
  });

  socket.on('set-auto-refill', ({ roomId, threshold, refillCount, topic, difficulty, genre }) => {
    const room = rooms[roomId];
    if (!room) return;
    room.autoRefillThreshold = typeof threshold === 'number' ? threshold : (room.autoRefillThreshold || 2);
    room.autoRefillCount = typeof refillCount === 'number' ? refillCount : (room.autoRefillCount || 5);
    if (topic) room.llmTopic = topic;
    if (typeof difficulty !== 'undefined') room.llmDifficulty = difficulty;
    if (typeof genre !== 'undefined') room.llmGenre = genre;
    io.to(roomId).emit('room-state', room);
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
          io.to(roomId).emit('question', { index: idx, q: qPublic, answerLength, answerHiragana: norm });
        } catch (e) {
          io.to(roomId).emit('question', { index: idx, q: { text: q.text }, answerLength: 0 });
        }
        room.currentIndex = idx + 1;
        // After sending, check remaining and trigger refill if under threshold
        maybeRefill(roomId, room).catch(e => console.warn('maybeRefill error in timer', e));
      }, interval);
      io.to(roomId).emit('auto-started', { interval });
    }
  });

  socket.on('set-questions', ({ roomId, questions }) => {
    const room = rooms[roomId];
    if (!room) return;
    room.questions = questions;
    io.to(roomId).emit('room-state', room);
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
        io.to(roomId).emit('room-state', room);
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
    try {
      const rawAns = q.answer || '';
      const norm = normalizeToHiragana(rawAns);
  const answerLength = Array.from(norm).length;
  const qPublic = { text: q.text };
  io.to(roomId).emit('question', { index: idx, q: qPublic, answerLength, answerHiragana: norm });
    } catch (e) {
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
    // Broadcast the answer to all clients in the room
    io.to(roomId).emit('reveal-answer', { index: idx, answer: q.answer });
  });

  // Player submits an answer (assembled hiragana string)
  socket.on('submit-answer', ({ roomId, index, answer }) => {
    const room = rooms[roomId];
    if (!room) return;
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
  });

  socket.on('buzz', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    // notify host which player buzzed
    const hostId = room.host;
    if (hostId) io.to(hostId).emit('buzzed', { playerId: socket.id, name: socket.data.name });
    // optionally broadcast to all
    io.to(roomId).emit('player-buzz', { playerId: socket.id, name: socket.data.name });
  });

  socket.on('generate-llm', async ({ roomId, topic, count, difficulty, genre }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (topic) room.llmTopic = topic;
    if (typeof difficulty !== 'undefined') room.llmDifficulty = difficulty;
    if (typeof genre !== 'undefined') room.llmGenre = genre;
    const questions = await generateQuestionsLLM(room.llmTopic || topic || 'general knowledge', count || 5, room.llmDifficulty || 3, room.llmGenre || '');
    room.questions = questions;
    io.to(roomId).emit('room-state', room);
  });

  socket.on('disconnect', () => {
    const data = socket.data || {};
    const { roomId } = data;
    if (roomId && rooms[roomId]) {
      delete rooms[roomId].players[socket.id];
      if (rooms[roomId].host === socket.id) rooms[roomId].host = null;
      io.to(roomId).emit('room-state', rooms[roomId]);
    }
    console.log('socket disconnected', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Quiz server running on http://localhost:${PORT}`);
});
