// src/lib/streaming/StreamingStateManager.js

/**
 * StreamingStateManager
 * Manages the accumulated state as events arrive.
 */
export class StreamingStateManager {
  constructor() {
    this._state = {
      steps: [],
      textChunks: [],
      artifact: null,
      status: 'idle', // idle | streaming | done | error
    };
    this._subscribers = [];
  }

  get state() {
    return { ...this._state };
  }

  subscribe(fn) {
    this._subscribers.push(fn);
    return () => {
      this._subscribers = this._subscribers.filter(s => s !== fn);
    };
  }

  _notify() {
    const currentState = { ...this._state, steps: [...this._state.steps], textChunks: [...this._state.textChunks] };
    if (this._state.artifact) {
        currentState.artifact = { ...this._state.artifact };
    }
    this._subscribers.forEach(fn => fn(currentState));
  }

  handleEvent(type, data) {
    switch (type) {
      case 'message_start':
        this._state.status = 'streaming';
        this._state.steps = [];
        this._state.textChunks = [];
        this._state.artifact = null;
        break;

      case 'content_block_start':
        if (data.content_block?.type === 'tool_use') {
          this._state.steps.push({
            id: data.content_block.id,
            name: data.content_block.name,
            status: 'running',
            inputJson: '',
          });
        }
        break;

      case 'content_block_delta':
        if (data.delta?.type === 'text_delta') {
          this._state.textChunks.push(data.delta.text);
          this._detectArtifact();
        }
        if (data.delta?.type === 'input_json_delta') {
          const step = this._state.steps[this._state.steps.length - 1];
          if (step && step.status === 'running') {
            step.inputJson += data.delta.partial_json;
          }
        }
        break;

      case 'content_block_stop':
        const lastStep = this._state.steps.find(s => s.status === 'running');
        if (lastStep) lastStep.status = 'done';
        break;

      case 'message_stop':
      case 'DONE':
        this._state.status = 'done';
        const finalStep = this._state.steps.find(s => s.status === 'running');
        if (finalStep) finalStep.status = 'done';
        break;
        
      case 'sub_task_start':
        this._state.steps.push({
          id: data.task_id || Date.now().toString(),
          name: `Task: ${data.instruction}`,
          status: 'running',
          inputJson: '',
        });
        break;

      case 'thought':
        this._state.steps.push({
          id: Date.now().toString(),
          name: 'Thinking...',
          status: 'done',
          isThought: true,
          inputJson: data.content.trim(),
        });
        break;

      case 'tool_use':
        this._state.steps.push({
          id: Date.now().toString(),
          name: data.name,
          status: 'running',
          inputJson: JSON.stringify(data.input, null, 2),
        });
        break;

      case 'tool_result':
        if (['generate_latex_artifact', 'generate_comprehensive_report'].includes(data.name) && data.result) {
          try {
            const parsed = JSON.parse(data.result);
            if (parsed.artifact_type === 'latex') {
              this._state.artifact = { lang: 'latex', code: parsed.content, open: false };
            }
          } catch (e) {
            // Not a valid json, ignore
          }
        }
        // Fallthrough
      case 'sub_task_end':
        const runningStep = this._state.steps.find(s => s.status === 'running');
        if (runningStep) runningStep.status = 'done';
        break;

      case 'final_answer':
        this._state.textChunks.push(data.content);
        this._detectArtifact();
        break;

      case 'status':
        // Optional: show status as a transient step or ignore
        break;

      case 'error':
        this._state.status = 'error';
        this._state.textChunks.push(`\n\n**Error**: ${data.message || 'Stream error'}`);
        break;
    }
    this._notify();
  }

  _detectArtifact() {
    const full = this._state.textChunks.join('');
    // Look for ```lang ... blocks (lang is optional)
    const match = full.match(/```(\w*)\s*\n([\s\S]*)/);
    
    if (match && !this._state.artifact) {
      this._state.artifact = { lang: match[1], code: '', open: true };
    }
    
    if (this._state.artifact?.open) {
      // Re-evaluate what's inside the fence
      const afterFence = full.split(/```\w+\n/)[1] || '';
      const closed = afterFence.split('```')[0];
      this._state.artifact.code = closed;
      
      // If there's another fence closing it
      if (afterFence.includes('```')) {
        this._state.artifact.open = false;
      }
    }
  }
}
