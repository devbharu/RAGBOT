// src/lib/streaming/StreamController.js

import { SSEParser } from './SSEParser';
import { StreamingStateManager } from './StreamingStateManager';

/**
 * StreamController
 * Facade orchestrator that handles fetch, SSEParser, and StreamingStateManager.
 */
export class StreamController {
  constructor(apiEndpoint) {
    this.endpoint = apiEndpoint;
    this.parser = new SSEParser();
    this.stateManager = new StreamingStateManager();
    this.abortController = null;
    this._wireParser();
  }

  _wireParser() {
    const events = [
      'message_start', 'content_block_start',
      'content_block_delta', 'content_block_stop',
      'message_delta', 'message_stop', 'DONE', 'error', 'chat_renamed',
      'sub_task_start', 'thought', 'tool_use', 'tool_result', 'sub_task_end', 'final_answer', 'status'
    ];

    events.forEach(type =>
      this.parser.on(type, data => {
        // chat_renamed is a special event in this system
        if (type === 'chat_renamed' && this.onChatRenamed) {
          this.onChatRenamed(data);
        } else {
          this.stateManager.handleEvent(type, data);
        }
      })
    );
  }

  get state() {
    return this.stateManager.state;
  }

  subscribe(fn) {
    return this.stateManager.subscribe(fn);
  }

  abort() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
      this.stateManager.handleEvent('message_stop', {});
    }
  }

  async send(payload, headers = {}) {
    this.abort(); // Cancel any existing
    this.abortController = new AbortController();

    // Reset state before sending
    this.stateManager.handleEvent('message_start', {});

    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        body: JSON.stringify(payload),
        signal: this.abortController.signal
      });

      if (!res.ok) {
        let msg = `API error: ${res.status}`;
        try { const err = await res.json(); msg = err.error || msg; } catch (e) { }
        this.stateManager.handleEvent('error', { message: msg });
        return;
      }

      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const data = await res.json();
        if (data.status === "running" && data.task_id) {
            // It's a background task, connect to the stream URL
            let streamUrl = this.endpoint.replace('/generate', `/chat/stream/${data.task_id}`);
            await this.connectToStreamUrl(streamUrl, headers);
            return;
        }
        
        // It's not a stream, it's a direct JSON response
        this.stateManager.handleEvent('content_block_start', { content_block: { type: 'text' } });
        this.stateManager.handleEvent('content_block_delta', { delta: { type: 'text_delta', text: data.response || "" } });
        this.stateManager.handleEvent('content_block_stop', {});
        this.stateManager.handleEvent('message_stop', {});
        return;
      }

      await this.parser.consume(res.body);
    } catch (err) {
      if (err.name !== 'AbortError') {
        this.stateManager.handleEvent('error', { message: err.message });
      }
    } finally {
      this.abortController = null;
    }
  }

  async connectToStreamUrl(url, headers = {}) {
    this.abort(); // Cancel any existing
    this.abortController = new AbortController();
    
    // Reset state before sending
    this.stateManager.handleEvent('message_start', {});
    
    try {
      const res = await fetch(url, {
          method: 'GET',
          headers: headers,
          signal: this.abortController.signal
      });
      
      if (!res.ok) {
          this.stateManager.handleEvent('error', { message: `Stream error: ${res.status}` });
          return;
      }
      
      await this.parser.consume(res.body);
    } catch (err) {
      if (err.name !== 'AbortError') {
        this.stateManager.handleEvent('error', { message: err.message });
      }
    } finally {
      this.abortController = null;
    }
  }
}
