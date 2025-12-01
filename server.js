const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const multer = require('multer');
const fs = require('fs');
require('dotenv').config();

// PDF.js for parsing PDFs
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json()); // for parsing POST body

// Configure multer for file uploads
const upload = multer({ 
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Simple in-memory rooms store (for demo/prototyping)
const rooms = {};

// Simple in-memory cache for grounding responses (TTL: 60 seconds)
const groundingCache = new Map();
const CACHE_TTL_MS = 60 * 1000;

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

// POST /api/upload-document - Upload PDF or HTML and extract text
app.post('/api/upload-document', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const mimeType = req.file.mimetype;
    let extractedText = '';

    try {
      if (mimeType === 'application/pdf') {
        // Parse PDF using PDF.js
        const dataBuffer = fs.readFileSync(filePath);
        const data = new Uint8Array(dataBuffer);
        const loadingTask = pdfjsLib.getDocument({ data });
        const pdfDocument = await loadingTask.promise;
        
        const textParts = [];
        for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
          const page = await pdfDocument.getPage(pageNum);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map(item => item.str).join(' ');
          textParts.push(pageText);
        }
        extractedText = textParts.join('\n');
      } else if (mimeType === 'text/html' || req.file.originalname.endsWith('.html')) {
        // Parse HTML - strip tags for simple text extraction
        const htmlContent = fs.readFileSync(filePath, 'utf-8');
        extractedText = htmlContent
          .replace(/<script[^>]*>.*?<\/script>/gis, '')
          .replace(/<style[^>]*>.*?<\/style>/gis, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      } else {
        // Try reading as plain text
        extractedText = fs.readFileSync(filePath, 'utf-8');
      }

      // Clean up uploaded file
      fs.unlinkSync(filePath);

      if (!extractedText || extractedText.trim().length === 0) {
        return res.status(400).json({ error: 'Could not extract text from document' });
      }

      // Truncate if too long (max 50000 chars to avoid API limits)
      if (extractedText.length > 50000) {
        extractedText = extractedText.substring(0, 50000) + '...';
      }

      return res.json({ 
        text: extractedText,
        length: extractedText.length,
        filename: req.file.originalname
      });
    } catch (parseError) {
      // Clean up file on error
      try { fs.unlinkSync(filePath); } catch(e) {}
      console.error('Document parsing error:', parseError);
      return res.status(500).json({ 
        error: 'Failed to parse document: ' + (parseError.message || String(parseError))
      });
    }
  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ 
      error: 'Upload failed: ' + (err.message || String(err))
    });
  }
});

// POST /api/generate-from-document - Generate questions from document text
app.post('/api/generate-from-document', async (req, res) => {
  try {
    const { documentText, count, difficulty, genre } = req.body;
    
    if (!documentText || typeof documentText !== 'string' || documentText.trim().length === 0) {
      return res.status(400).json({ error: 'documentText is required' });
    }

    if (!genaiClient) {
      return res.status(500).json({ 
        error: 'Gemini API client is not initialized',
        questions: []
      });
    }

    const questionCount = Math.min(20, Math.max(1, parseInt(count) || 5));
    const difficultyNum = Math.max(1, Math.min(10, parseInt(difficulty) || 3));
    const genreDesc = genre ? `ジャンル: ${genre}` : '';
    const difficultyDesc = `難易度 ${difficultyNum}（1=小学生レベル、10=大学専門科目レベル）`;
    
    // Truncate document text if too long
    let docText = documentText;
    if (docText.length > 30000) {
      docText = docText.substring(0, 30000) + '...';
    }

    const prompt = `以下のドキュメント内容に基づいて、クイズ問題を生成してください。

【ドキュメント内容】
${docText}

【指示】
${genreDesc} ${difficultyDesc}
上記のドキュメント内容に基づいて、出題者用の短いクイズ問題を日本語で${questionCount}問生成してください。
各問題は1文で、回答も併記してください。
回答は必ず一意に定まるように問題を出してください。
ドキュメントの内容に基づいた事実を問う問題にしてください。

【出力形式】
JSON配列のみを返し、他のテキストは含めないでください。
各オブジェクトの "answer" フィールドは必ずひらがなで記載してください。

例: [{"text": "問題文", "answer": "こたえ"}]

出力:`;

    const modelId = process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp';
    
    const genReq = {
      model: modelId,
      contents: [{ parts: [{ text: prompt }] }]
    };

    let response;
    try {
      response = await genaiClient.models.generateContent(genReq);
    } catch (apiError) {
      console.error('Gemini API call failed:', apiError);
      return res.status(500).json({
        error: 'Gemini API call failed: ' + (apiError.message || String(apiError)),
        questions: []
      });
    }

    let raw = '';
    if (response && typeof response.text === 'string') {
      raw = response.text;
    } else if (response?.candidates && response.candidates.length) {
      const cand = response.candidates[0];
      if (cand?.content?.parts && cand.content.parts.length > 0 && cand.content.parts[0].text) {
        raw = cand.content.parts[0].text;
      }
    }

    // Parse JSON response
    let questions = [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        questions = parsed.map((q, i) => ({
          id: `doc-${Date.now()}-${i}`,
          text: q.text || q.question || '',
          answer: normalizeToHiragana(q.answer || q.answer_text || '')
        })).filter(q => q.text && q.answer);
      }
    } catch (parseErr) {
      // Try to extract JSON array from response
      const s = raw.indexOf('[');
      const e = raw.lastIndexOf(']');
      if (s !== -1 && e !== -1 && e > s) {
        try {
          const sub = raw.slice(s, e + 1);
          const parsed = JSON.parse(sub);
          if (Array.isArray(parsed)) {
            questions = parsed.map((q, i) => ({
              id: `doc-${Date.now()}-${i}`,
              text: q.text || q.question || '',
              answer: normalizeToHiragana(q.answer || q.answer_text || '')
            })).filter(q => q.text && q.answer);
          }
        } catch (e2) {
          console.warn('Failed to parse extracted JSON:', e2);
        }
      }
    }

    if (questions.length === 0) {
      return res.status(500).json({
        error: 'Could not generate questions from document',
        questions: [],
        rawResponse: raw.substring(0, 500)
      });
    }

    return res.json({ questions, count: questions.length });

  } catch (err) {
    console.error('generate-from-document error:', err);
    return res.status(500).json({
      error: 'Internal error: ' + (err.message || String(err)),
      questions: []
    });
  }
});

// POST /api/generate - Generate content with Google Search grounding
// 
// SECURITY & TERMS OF SERVICE NOTES:
// - API key is kept server-side only and never exposed to clients
// - User prompts are validated for length and type
// - searchEntryPoint HTML/CSS from Google must be rendered as-is (per ToS)
// - User queries may be sent to Google Search (privacy consideration)
// - Rate limiting should be implemented for production use
// - XSS protection: Do not directly embed user-provided HTML
//
app.post('/api/generate', async (req, res) => {
  try {
    const { prompt, model } = req.body;
    
    // Validation
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return res.status(400).json({ error: 'prompt is required and must be a non-empty string' });
    }
    
    if (prompt.length > 4000) {
      return res.status(400).json({ error: 'prompt is too long (max 4000 characters)' });
    }
    
    // Check cache
    const cacheKey = `${prompt}:${model || 'default'}`;
    const cached = groundingCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
      console.log('Returning cached grounding response');
      return res.json(cached.data);
    }
    
    // Check if genaiClient is available
    if (!genaiClient) {
      return res.status(500).json({ 
        error: 'Gemini API client is not initialized. Set GEMINI_API_KEY environment variable.',
        text: null,
        groundingMetadata: null
      });
    }
    
    const modelId = model || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    
    // Configure grounding tool
    const groundingTool = {
      googleSearch: {}
    };
    
    const config = {
      tools: [groundingTool]
    };
    
    // Call Gemini API with grounding
    const genReq = {
      model: modelId,
      contents: [{ parts: [{ text: prompt }] }],
      config: config
    };
    
    let response;
    try {
      response = await genaiClient.models.generateContent(genReq);
    } catch (apiError) {
      console.error('Gemini API call failed:', apiError);
      return res.status(500).json({
        error: 'Gemini API call failed: ' + (apiError.message || String(apiError)),
        text: null,
        groundingMetadata: null
      });
    }
    
    // Parse response
    let text = '';
    let groundingMetadata = null;
    
    // Extract text from response
    if (response && typeof response.text === 'string') {
      text = response.text;
    } else if (response?.candidates && response.candidates.length) {
      const cand = response.candidates[0];
      if (cand?.content?.parts && cand.content.parts.length) {
        text = cand.content.parts.map(p => p.text || '').join('');
      }
      
      // Extract grounding metadata
      if (cand.groundingMetadata) {
        groundingMetadata = {
          webSearchQueries: cand.groundingMetadata.webSearchQueries || [],
          groundingChunks: (cand.groundingMetadata.groundingChunks || []).map(chunk => ({
            uri: chunk.web?.uri || '',
            title: chunk.web?.title || ''
          })),
          groundingSupports: (cand.groundingMetadata.groundingSupports || []).map(support => ({
            segment: {
              startIndex: support.segment?.startIndex || 0,
              endIndex: support.segment?.endIndex || 0,
              text: support.segment?.text || ''
            },
            groundingChunkIndices: support.groundingChunkIndices || []
          })),
          searchEntryPoint: cand.groundingMetadata.searchEntryPoint || null
        };
      }
    }
    
    const result = {
      text: text || '（回答を取得できませんでした）',
      groundingMetadata: groundingMetadata
    };
    
    // Cache the result
    groundingCache.set(cacheKey, {
      timestamp: Date.now(),
      data: result
    });
    
    // Clean old cache entries
    const now = Date.now();
    for (const [key, value] of groundingCache.entries()) {
      if (now - value.timestamp > CACHE_TTL_MS) {
        groundingCache.delete(key);
      }
    }
    
    return res.json(result);
    
  } catch (err) {
    console.error('Unexpected error in /api/generate:', err);
    return res.status(500).json({
      error: 'Internal server error: ' + (err.message || String(err)),
      text: null,
      groundingMetadata: null
    });
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

async function generateQuestionsLLM(topic = 'general knowledge', count = 5, difficulty = 3, genre = '', enableGrounding = true) {
  // NOTE:
  // - Do NOT return sample/fallback questions on failures anymore.
  // - Retry the Gemini API multiple times with variable backoff until a valid
  //   question set is produced or until the overall timeout is reached.
  // - If Gemini client is not available, throw so callers can handle it and
  //   avoid silently inserting sample questions.

  if (!useGemini || !genaiClient) {
    throw new Error('Gemini API client is not available');
  }

  console.log(`Generating questions with grounding: ${enableGrounding ? 'ENABLED' : 'DISABLED'}`);

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

  // Helper function to call Gemini API with optional grounding
  const callGeminiAPI = async (withGrounding = true, attemptNum = 1) => {
    const modelId = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    
    const genReq = {
      model: modelId,
      contents: [{ parts: [{ text: fullPrompt }] }]
    };
    
    // Add grounding tool if requested AND globally enabled
    if (withGrounding && enableGrounding) {
      genReq.config = {
        tools: [{ googleSearch: {} }]
      };
    }
    
    console.log(`Gemini API call attempt ${attemptNum} ${withGrounding && enableGrounding ? 'WITH' : 'WITHOUT'} grounding`);
    
    try {
      const response = await genaiClient.models.generateContent(genReq);
      
      let raw = '';
      let metadata = null;
      
      // Extract grounding metadata if available
      if (response?.candidates && response.candidates[0]?.groundingMetadata) {
        metadata = response.candidates[0].groundingMetadata;
        console.log(`Grounding metadata found: ${metadata.groundingChunks?.length || 0} sources`);
      }
      
      // Extract text from response - handle multiple possible structures
      if (response && typeof response.text === 'string') {
        raw = response.text;
      } else if (response?.candidates && response.candidates.length) {
        const cand = response.candidates[0];
        // Try different nested structures
        if (cand?.content?.parts && cand.content.parts.length > 0 && cand.content.parts[0].text) {
          raw = cand.content.parts[0].text;
        } else if (cand?.content && cand.content[0]?.parts && cand.content[0].parts[0]?.text) {
          raw = cand.content[0].parts[0].text;
        } else {
          // No valid text found in expected structure
          raw = JSON.stringify(cand);
        }
      } else if (response?.output && response.output.length) {
        const out = response.output[0];
        if (out?.content?.parts && out.content.parts[0]?.text) {
          raw = out.content.parts[0].text;
        } else if (out?.content && out.content[0]?.parts && out.content[0].parts[0]?.text) {
          raw = out.content[0].parts[0].text;
        } else {
          raw = JSON.stringify(out);
        }
      } else {
        raw = JSON.stringify(response);
      }
      
      // Validate that we got actual text content, not just JSON metadata
      if (!raw || raw.trim().length === 0 || (raw.startsWith('{') && !raw.includes('['))) {
        console.warn('Response did not contain text content, only metadata');
        return { raw: '', metadata, success: false, error: new Error('No text content in response') };
      }
      
      return { raw, metadata, success: true };
    } catch (error) {
      console.warn(`Gemini API call attempt ${attemptNum} failed:`, error.message);
      return { raw: '', metadata: null, success: false, error };
    }
  };

  // We'll implement a retry loop with exponential backoff + jitter.
  // Stop when we obtain at least one valid question object.
  const tryParse = (text) => {
    try {
      const arr = JSON.parse(text);
      if (Array.isArray(arr)) return arr;
    } catch (e) {
      // ignore
    }
    return null;
  };

  const processArray = (inArr, metadata) => {
    const out = [];
    for (let i = 0; i < inArr.length; i++) {
      const q = inArr[i] || {};
      const text = q.text || q.question || '';
      const rawAns = (q.answer || q.answer_text || q.answerText || '');
      const norm = normalizeToHiragana(rawAns || '');
      if (norm && norm.length > 0) {
        const question = {
          id: `llm-${Date.now()}-${i}`,
          text: text,
          answer: norm
        };
        if (metadata?.groundingChunks && metadata.groundingChunks.length > 0) {
          question.sources = metadata.groundingChunks.map(chunk => ({
            title: chunk.web?.title || 'Unknown',
            uri: chunk.web?.uri || ''
          })).filter(src => src.uri);
        }
        out.push(question);
      }
    }
    return out;
  };

  const MAX_TOTAL_MS = 60 * 1000; // total retry window (60s)
  const MAX_ATTEMPTS = 8;
  const startTs = Date.now();
  let attempt = 0;
  let lastRaw = '';
  let lastMetadata = null;
  let lastErr = null;

  while ((Date.now() - startTs) < MAX_TOTAL_MS && attempt < MAX_ATTEMPTS) {
    attempt += 1;
    // Try with grounding first, then optionally without in later attempts
    const withGrounding = enableGrounding;
    const res = await callGeminiAPI(withGrounding, attempt);
    if (res.success) {
      lastRaw = res.raw;
      lastMetadata = res.metadata;
      // attempt to parse
      let arr = tryParse(lastRaw);
      if (!arr) {
        const s = lastRaw.indexOf('[');
        const e = lastRaw.lastIndexOf(']');
        if (s !== -1 && e !== -1 && e > s) {
          const sub = lastRaw.slice(s, e + 1);
          arr = tryParse(sub);
        }
      }
      if (arr && Array.isArray(arr)) {
        const results = processArray(arr, lastMetadata);
        if (results && results.length > 0) {
          // Return up to requested count. Caller (maybeRefill) will append.
          return results.slice(0, count);
        }
      }
      // If parsing succeeded but no valid entries, treat as failure and retry
      lastErr = new Error('Parsed response contained no valid questions');
    } else {
      lastErr = res.error || new Error('Gemini API call failed');
    }

    // Backoff before next attempt
    const base = Math.min(16000, 1000 * Math.pow(2, attempt - 1));
    const jitter = Math.floor(Math.random() * 500);
    const waitMs = base + jitter;
    console.log(`generateQuestionsLLM attempt ${attempt} failed, waiting ${waitMs}ms before retrying`);
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }

  // If we get here, we exhausted retries/timeout — throw to avoid returning sample/fallback.
  const errMsg = lastErr ? String(lastErr) : 'generateQuestionsLLM: retries exhausted';
  console.warn(errMsg, 'lastRaw:', lastRaw ? (lastRaw.slice(0, 240) + (lastRaw.length > 240 ? '...' : '')) : '');
  throw new Error(errMsg);
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

// Helper to check if room has active players (excluding host)
function hasActivePlayers(room) {
  if (!room || !room.players) return false;
  return Object.keys(room.players).length > 0;
}

// Helper to pause LLM timers when no players
function pauseLLMTimers(room, roomId) {
  if (!room || !room.llmTimer) return;
  
  console.log(`Pausing LLM timers for room ${roomId} - no active players`);
  
  if (room.llmTimer.questionTimer) {
    try { clearTimeout(room.llmTimer.questionTimer); } catch(e){}
    room.llmTimer.questionTimer = null;
  }
  if (room.llmTimer.revealTimer) {
    try { clearTimeout(room.llmTimer.revealTimer); } catch(e){}
    room.llmTimer.revealTimer = null;
  }
  
  room.llmPaused = true;
  io.to(roomId).emit('llm-paused', { reason: 'no-players' });
}

// Create a sanitized view of a room suitable for emitting to clients.
// Excludes timer objects and full answers to avoid circular refs and leaking answers.
function sanitizeRoom(room) {
  if (!room) return {};
  
  // Sanitize players to avoid circular references
  const sanitizedPlayers = {};
  if (room.players && typeof room.players === 'object') {
    for (const [id, player] of Object.entries(room.players)) {
      if (player && typeof player === 'object') {
        sanitizedPlayers[id] = {
          name: player.name || null,
          score: player.score || 0
        };
      }
    }
  }
  
  return {
    host: room.host || null,
    players: sanitizedPlayers,
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
    enableGrounding: (typeof room.enableGrounding === 'boolean') ? room.enableGrounding : true,
    refilling: !!room.refilling,
    llmPaused: !!room.llmPaused
    // Explicitly exclude: autoTimer, llmTimer, currentResponder (socket.id reference), and any other circular refs
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
      // Start background refill loop which will keep retrying until success.
      startRefillLoop(roomId, room, { topic: room.llmTopic || 'general knowledge', count: refillCount, difficulty: room.llmDifficulty || 3, genre: room.llmGenre || '', enableGrounding: room.enableGrounding !== false });
    }
  } catch (e) { console.warn('maybeRefill error', e); }
}

// Start a background refill loop that will attempt generateQuestionsLLM repeatedly
// with exponential backoff + jitter until it succeeds. Emits room-state updates
// while refilling and on completion. Multiple concurrent loops for the same
// room are prevented by checking room.refilling.
function startRefillLoop(roomId, room, { topic = 'general knowledge', count = 5, difficulty = 3, genre = '', enableGrounding = true } = {}) {
  if (!room || room.refilling) return;
  room.refilling = true;
  io.to(roomId).emit('room-state', sanitizeRoom(room));

  (async () => {
    console.log(`startRefillLoop: room=${roomId} starting background refill`);
    let attempt = 0;
    let backoffBase = 1000; // start 1s
    const maxBackoff = 30000; // cap 30s
    while (room.refilling) {
      attempt += 1;
      try {
        console.log(`startRefillLoop: room=${roomId} attempt ${attempt}`);
        const more = await generateQuestionsLLM(topic, count, difficulty, genre, enableGrounding);
        if (Array.isArray(more) && more.length) {
          const before = room.questions.length;
          room.questions = room.questions.concat(more);
          const after = room.questions.length;
          console.log(`startRefillLoop: room ${roomId} appended ${after - before} questions (total ${after})`);
          room.refilling = false;
          io.to(roomId).emit('room-state', sanitizeRoom(room));
          // notify callers that manual force-refill completed
          try { io.to(roomId).emit('force-refill-complete', { added: after - before }); } catch (e) {}
          return;
        }
        console.log(`startRefillLoop: room=${roomId} generate returned empty; will retry`);
      } catch (e) {
        console.warn(`startRefillLoop: room=${roomId} attempt ${attempt} failed:`, e && e.message ? e.message : e);
      }

      // compute backoff with jitter
      const backoff = Math.min(maxBackoff, backoffBase * Math.pow(2, Math.max(0, attempt - 1)));
      const jitter = Math.floor(Math.random() * 1000);
      const waitMs = backoff + jitter;
      console.log(`startRefillLoop: room=${roomId} waiting ${waitMs}ms before next attempt`);
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
    // If we exit loop because room.refilling was cleared elsewhere, ensure state emitted
    room.refilling = false;
    io.to(roomId).emit('room-state', sanitizeRoom(room));
    console.log(`startRefillLoop: room=${roomId} stopped (refilling flag cleared)`);
  })();
}

io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  socket.on('join', ({ roomId, name, role }) => {
    socket.join(roomId);
    socket.data = { roomId, name, role };
  rooms[roomId] = rooms[roomId] || { host: null, players: {}, questions: [], mode: null, started: false, currentIndex: null, answerLocked: false };
    if (role === 'host') rooms[roomId].host = socket.id;
    if (role === 'player') {
      rooms[roomId].players[socket.id] = { id: socket.id, name };
      
      // If LLM mode was paused due to no players, resume it by triggering next question
      const room = rooms[roomId];
      if (room.mode === 'llm' && room.started && room.llmPaused && room.questions && room.questions.length > 0) {
        console.log(`Player joined room ${roomId} - resuming LLM mode`);
        room.llmPaused = false;
        io.to(roomId).emit('llm-resumed', { reason: 'player-joined' });
        
        // Only resume if there's no active timer (meaning it was truly paused)
        if (!room.llmTimer || (!room.llmTimer.questionTimer && !room.llmTimer.revealTimer)) {
          // Resume by sending current or next question
          const idx = (typeof room.currentIndex === 'number') ? room.currentIndex : 0;
          const q = room.questions[idx];
          if (q) {
            // Send the current question
            room.currentResponder = null;
            room.answerLocked = false;
            try {
              const rawAns = q.answer || '';
              const norm = normalizeToHiragana(rawAns);
              const answerLength = Array.from(norm).length;
              const qPublic = { text: q.text };
              const interval = room.llmIntervalMs || room.autoIntervalMs || 10000;
              io.to(roomId).emit('question', { index: idx, q: qPublic, answerLength, answerHiragana: norm, timeAllowedMs: interval });
            } catch (e) {
              const interval = room.llmIntervalMs || room.autoIntervalMs || 10000;
              io.to(roomId).emit('question', { index: idx, q: { text: q.text }, answerLength: 0, timeAllowedMs: interval });
            }
            
            // Restart the LLM timer cycle
            const interval = room.llmIntervalMs || room.autoIntervalMs || 10000;
            const revealMs = room.llmRevealMs || 3000;
            
            room.llmTimer = room.llmTimer || {};
            room.llmTimer.questionTimer = setTimeout(function questionTimeout() {
              if (!hasActivePlayers(room)) {
                pauseLLMTimers(room, roomId);
                return;
              }
              
              const idx = room.currentIndex;
              const q = room.questions[idx];
              if (q) {
                room.answerLocked = true;
                io.to(roomId).emit('reveal-answer', { index: idx, answer: q.answer });
              }
              
              room.llmTimer.revealTimer = setTimeout(async () => {
                if (!hasActivePlayers(room)) {
                  pauseLLMTimers(room, roomId);
                  return;
                }
                
                const nextIdx = (typeof room.currentIndex === 'number' ? room.currentIndex : 0) + 1;
                await maybeRefill(roomId, room).catch(e => console.warn('maybeRefill error after resume', e));
                
                if (nextIdx >= (room.questions ? room.questions.length : 0)) {
                  io.to(roomId).emit('auto-finished');
                  room.llmTimer = null;
                  return;
                }
                
                const qn = room.questions[nextIdx];
                room.currentIndex = nextIdx;
                room.currentResponder = null;
                room.answerLocked = false;
                
                try {
                  const norm = normalizeToHiragana(qn.answer || '');
                  const answerLength = Array.from(norm).length;
                  const qPublic = { text: qn.text };
                  io.to(roomId).emit('question', { index: nextIdx, q: qPublic, answerLength, answerHiragana: norm, timeAllowedMs: interval });
                } catch (e) {
                  io.to(roomId).emit('question', { index: nextIdx, q: { text: qn.text }, answerLength: 0, timeAllowedMs: interval });
                }
                
                room.llmTimer.questionTimer = setTimeout(questionTimeout, interval);
              }, revealMs);
            }, interval);
          }
        } else {
          console.log(`LLM timers already active, not restarting`);
        }
      }
    }

  io.to(roomId).emit('room-state', sanitizeRoom(rooms[roomId]));
  });

  socket.on('generate-llm', async ({ roomId, topic, count, difficulty, genre, llmIntervalMs, llmRevealMs, perCharSec, enableGrounding }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (topic) room.llmTopic = topic;
    if (typeof difficulty !== 'undefined') room.llmDifficulty = difficulty;
    if (typeof genre !== 'undefined') room.llmGenre = genre;
    if (typeof llmIntervalMs === 'number') room.llmIntervalMs = llmIntervalMs;
    if (typeof llmRevealMs === 'number') room.llmRevealMs = llmRevealMs;
    if (typeof perCharSec === 'number') room.perCharSec = perCharSec;
    if (typeof enableGrounding === 'boolean') room.enableGrounding = enableGrounding;
    // Start background refill loop; do not block socket handler. Clients will
    // see room.refilling=true and the loop will clear it when done.
    startRefillLoop(roomId, room, { topic: room.llmTopic || topic || 'general knowledge', count: count || 5, difficulty: room.llmDifficulty || 3, genre: room.llmGenre || '', enableGrounding: room.enableGrounding !== false });
    socket.emit('generate-llm-started', { started: true });
  });

  socket.on('disconnect', () => {
    const data = socket.data || {};
    const { roomId, role } = data;
    if (roomId && rooms[roomId]) {
      const room = rooms[roomId];
      
      // Remove player or host
      if (role === 'player') {
        delete room.players[socket.id];
        
        // Check if no more players remain in LLM mode
        if (room.mode === 'llm' && room.started && !hasActivePlayers(room)) {
          console.log(`Last player left room ${roomId} - pausing LLM mode`);
          pauseLLMTimers(room, roomId);
        }
      }
      
      if (room.host === socket.id) {
        room.host = null;
      }

      // If the disconnecting socket was the current responder, clear that state
      if (room.currentResponder === socket.id) {
        try { if (room.answerTimer) { clearTimeout(room.answerTimer); room.answerTimer = null; } } catch(e){}
        room.currentResponder = null;
        room.answerLocked = false;
        // notify room that buzzer was cancelled due to disconnect
        try { io.to(roomId).emit('buzz-cancelled', { playerId: socket.id, name: socket.data && socket.data.name, reason: 'disconnect' }); } catch(e){}
      }
      
      io.to(roomId).emit('room-state', sanitizeRoom(room));
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

  socket.on('set-auto-refill', ({ roomId, threshold, refillCount, topic, difficulty, genre, llmIntervalMs, llmRevealMs, perCharSec, enableGrounding }) => {
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
    // grounding toggle
    if (typeof enableGrounding === 'boolean') room.enableGrounding = enableGrounding;

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

  // Restart game: reset questions (regenerate if LLM mode) and reset index
  socket.on('restart-game', async ({ roomId, topic, count, difficulty, genre, llmIntervalMs, llmRevealMs, perCharSec, threshold, enableGrounding }) => {
    const room = rooms[roomId];
    if (!room) return;
    
    // stop any running timers
    if (room.autoTimer) {
      try { clearInterval(room.autoTimer); } catch(e){}
      room.autoTimer = null;
    }
    if (room.llmTimer) {
      try { clearTimeout(room.llmTimer.questionTimer); } catch(e){}
      try { clearTimeout(room.llmTimer.revealTimer); } catch(e){}
      room.llmTimer = null;
    }
    
    // reset state
    room.currentIndex = 0;
    room.started = false;
    room.answerLocked = false;
    room.currentResponder = null;
    
    // if LLM mode, regenerate questions with provided or existing settings
    if (room.mode === 'llm') {
      room.questions = [];
      
      // Update room settings with provided values (or keep existing)
      if (topic) room.llmTopic = topic;
      if (typeof difficulty !== 'undefined') room.llmDifficulty = difficulty;
      if (typeof genre !== 'undefined') room.llmGenre = genre;
      if (typeof count === 'number') room.autoRefillCount = count;
      if (typeof llmIntervalMs === 'number') room.llmIntervalMs = llmIntervalMs;
      if (typeof llmRevealMs === 'number') room.llmRevealMs = llmRevealMs;
      if (typeof perCharSec === 'number') room.perCharSec = perCharSec;
      if (typeof threshold === 'number') room.autoRefillThreshold = threshold;
      if (typeof enableGrounding === 'boolean') room.enableGrounding = enableGrounding;
      
      const finalTopic = room.llmTopic || 'general knowledge';
      const finalCount = room.autoRefillCount || 5;
      const finalDifficulty = room.llmDifficulty || 3;
      const finalGenre = room.llmGenre || '';
      const finalEnableGrounding = room.enableGrounding !== false;
      
      try {
        // Start background refill instead of waiting synchronously. Emit an
        // immediate response; completion will be visible via room-state and
        // 'force-refill-complete' event (same event used by background loop).
        startRefillLoop(roomId, room, { topic: finalTopic, count: finalCount, difficulty: finalDifficulty, genre: finalGenre, enableGrounding: finalEnableGrounding });
        socket.emit('restart-game-result', { success: true, started: true });
      } catch (e) {
        console.error('restart-game: failed to start background refill', e);
        socket.emit('restart-game-result', { success: false, error: String(e) });
      }
    } else {
      // for non-LLM modes, just reset index and state
      io.to(roomId).emit('room-state', sanitizeRoom(room));
      socket.emit('restart-game-result', { success: true, questionsCount: room.questions.length });
    }
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
        // Check if there are active players before starting LLM auto-generation
        if (!hasActivePlayers(room)) {
          console.log(`LLM mode start skipped for room ${roomId} - no active players`);
          io.to(roomId).emit('llm-paused', { reason: 'no-players' });
          room.llmPaused = true;
          return;
        }
        
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
        room.llmPaused = false;
        room.llmTimer.questionTimer = setTimeout(function questionTimeout() {
          // Check for active players before continuing
          if (!hasActivePlayers(room)) {
            pauseLLMTimers(room, roomId);
            return;
          }
          
          const idx = room.currentIndex;
          const q = room.questions[idx];
          if (q) {
            room.answerLocked = true;
            io.to(roomId).emit('reveal-answer', { index: idx, answer: q.answer });
          }
          // after reveal delay, advance
          room.llmTimer.revealTimer = setTimeout(async () => {
            // Check for active players before advancing
            if (!hasActivePlayers(room)) {
              pauseLLMTimers(room, roomId);
              return;
            }
            
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
    // Start background refill loop; notify client that refill started. When
    // the background loop completes it will emit 'force-refill-complete'.
    startRefillLoop(roomId, room, { topic: room.llmTopic || 'general knowledge', count: room.autoRefillCount || 5, difficulty: room.llmDifficulty || 3, genre: room.llmGenre || '', enableGrounding: room.enableGrounding !== false });
    socket.emit('force-refill-result', { started: true });
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


