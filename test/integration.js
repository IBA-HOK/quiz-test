const { spawn } = require('child_process');
const io = require('socket.io-client');

const SERVER_CMD = 'node';
const SERVER_ARGS = ['server.js'];

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  console.log('Starting server...');
  const server = spawn(SERVER_CMD, SERVER_ARGS, { stdio: ['ignore','pipe','pipe'], cwd: process.cwd() });
  server.stdout.on('data', d => process.stdout.write(`[server] ${d}`));
  server.stderr.on('data', d => process.stderr.write(`[server] ${d}`));

  // wait a bit for server to start
  await wait(800);

  const url = 'http://localhost:3000';
  const roomId = 'test-room';

  const host = io(url, { reconnectionDelay: 0, timeout: 2000 });
  const p1 = io(url, { reconnectionDelay: 0, timeout: 2000 });
  const p2 = io(url, { reconnectionDelay: 0, timeout: 2000 });

  const questions = [{ id: 'q1', text: '日本の首都はどこですか？', answer: 'とうきょう' }];

  function cleanup(code=0) {
    try { host.close(); } catch(e){}
    try { p1.close(); } catch(e){}
    try { p2.close(); } catch(e){}
    server.kill();
    process.exit(code);
  }

  host.on('connect', async () => {
    console.log('host connected');
    host.emit('join', { roomId, role: 'host', name: 'host' });
    // set questions
    await wait(200);
    host.emit('set-questions', { roomId, questions });
  });

  let resolved = false;

  p1.on('connect', () => {
    console.log('p1 connected');
    p1.emit('join', { roomId, name: 'p1', role: 'player' });
  });
  p2.on('connect', () => {
    console.log('p2 connected');
    p2.emit('join', { roomId, name: 'p2', role: 'player' });
  });

  // p1 listens for question then buzzes and answers
  p1.on('question', async ({ index, q, answerLength, answerHiragana }) => {
    console.log('p1 got question:', q.text);
    // attempt to buzz quickly
    await wait(100);
    p1.emit('buzz', { roomId });
  });

  p1.on('buzz-granted', ({ index, answerWindowMs }) => {
    console.log('p1 buzz granted, will submit answer');
    // submit correct answer
    setTimeout(() => {
      p1.emit('submit-answer', { roomId, index, answer: 'とうきょう' });
    }, 200);
  });

  p1.on('answer-result', ({ index, ok, error }) => {
    console.log('p1 answer-result', ok, error);
    if (ok && !resolved) {
      console.log('TEST PASS: p1 answered correctly');
      resolved = true;
      cleanup(0);
    }
  });

  p1.on('buzz-denied', (d) => console.log('p1 buzz denied', d));
  p2.on('buzz-granted', (d) => console.log('p2 buzz granted', d));
  p2.on('buzz-denied', (d) => console.log('p2 buzz denied', d));

  // after setup, ask host to next-question
  setTimeout(() => {
    console.log('host requesting next-question');
    host.emit('next-question', { roomId, index: 0 });
  }, 500);

  // overall timeout
  setTimeout(() => {
    if (!resolved) {
      console.log('TEST FAIL: timeout');
      cleanup(1);
    }
  }, 10000);

})();
