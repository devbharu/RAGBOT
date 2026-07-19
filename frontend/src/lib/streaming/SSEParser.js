// src/lib/streaming/SSEParser.js

/**
 * SSEParser
 * Reads a raw ReadableStream and emits typed events based on SSE protocol.
 */
export class SSEParser {
  constructor() {
    this.listeners = new Map();
    this.buffer = '';
  }

  on(eventType, callback) {
    if (!this.listeners.has(eventType)) this.listeners.set(eventType, []);
    this.listeners.get(eventType).push(callback);
    return this;
  }

  async consume(readableStream) {
    const reader = readableStream.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        this._flush(true);
        break;
      }
      this.buffer += decoder.decode(value, { stream: true });
      this._flush();
    }
  }

  _flush(isDone = false) {
    const chunks = this.buffer.split('\n\n');
    if (!isDone) {
      this.buffer = chunks.pop() || '';
    } else {
      this.buffer = '';
    }

    for (const chunk of chunks) {
      if (!chunk.trim()) continue;
      const lines = chunk.split('\n');
      let eventType = 'message';
      let dataStr = '';

      for (const line of lines) {
        if (line.startsWith('event: ')) eventType = line.slice(7).trim();
        if (line.startsWith('data: ')) dataStr = line.slice(6).trim();
      }

      if (!dataStr) continue;
      
      // If it's a legacy "[DONE]" or similar, ignore or emit specialized event
      if (dataStr === '[DONE]') {
        this._emit('DONE', {});
        continue;
      }

      try {
        const data = JSON.parse(dataStr);
        this._emit(eventType, data);
        if (data.type && data.type !== eventType) {
          this._emit(data.type, data);
        }
      } catch (err) {
        // Silently ignore JSON parse errors for incomplete chunks (shouldn't happen with SSE \n\n boundaries)
      }
    }
  }

  _emit(type, data) {
    (this.listeners.get(type) || []).forEach(cb => cb(data));
  }
}
