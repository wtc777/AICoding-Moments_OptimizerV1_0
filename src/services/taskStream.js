const { EventEmitter } = require('events');

const streamBus = new EventEmitter();
streamBus.setMaxListeners(0);

function writeEvent(res, event, payload) {
  const data = payload ? JSON.stringify(payload) : '{}';
  res.write(`event: ${event}\n`);
  res.write(`data: ${data}\n\n`);
}

function attachTaskStream(taskId, res) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  let closed = false;
  const tokenEvent = `${taskId}:token`;
  const doneEvent = `${taskId}:done`;
  const errorEvent = `${taskId}:error`;
  const onToken = (token) => writeEvent(res, 'token', { token });
  const onPing = () => writeEvent(res, 'ping', {});
  const onDone = (payload) => {
    writeEvent(res, 'done', payload || {});
    cleanup();
  };
  const onError = (message) => {
    writeEvent(res, 'error', { message: message || 'Stream error' });
    cleanup();
  };

  const heartbeat = setInterval(onPing, 15000);
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    streamBus.off(tokenEvent, onToken);
    streamBus.off(doneEvent, onDone);
    streamBus.off(errorEvent, onError);
    res.end();
  };

  streamBus.on(tokenEvent, onToken);
  streamBus.on(doneEvent, onDone);
  streamBus.on(errorEvent, onError);

  res.on('close', cleanup);
  res.on('error', cleanup);

  return cleanup;
}

function emitTaskToken(taskId, token) {
  if (!taskId || !token) return;
  streamBus.emit(`${taskId}:token`, token);
}

function emitTaskDone(taskId, payload) {
  if (!taskId) return;
  streamBus.emit(`${taskId}:done`, payload);
}

function emitTaskError(taskId, message) {
  if (!taskId) return;
  streamBus.emit(`${taskId}:error`, message);
}

module.exports = {
  attachTaskStream,
  emitTaskToken,
  emitTaskDone,
  emitTaskError
};
