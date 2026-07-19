import uuid
import threading
import time

class TaskManager:
    """
    Manages background LLM generation tasks with a replay buffer.
    
    Instead of a Queue (which loses data after consumption), each task
    stores chunks in a list. Consumers read from a position index, so
    reconnecting clients can replay all previously generated chunks
    and then continue receiving new ones in real-time.
    """
    _instance = None
    _lock = threading.Lock()
    
    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super(TaskManager, cls).__new__(cls)
                cls._instance.streams = {}
        return cls._instance

    def create_task(self):
        task_id = str(uuid.uuid4())
        self.streams[task_id] = {
            "chunks": [],          # Ordered list of all SSE chunks
            "done": False,         # True when the generator has finished
            "error": None,
            "lock": threading.Lock(),
            "event": threading.Event(),  # Signaled when new chunks arrive or task ends
            "created_at": time.time()
        }
        return task_id
        
    def push_chunk(self, task_id, chunk):
        task = self.streams.get(task_id)
        if not task:
            return
        with task["lock"]:
            task["chunks"].append(chunk)
        task["event"].set()   # Wake up any waiting consumers
        task["event"].clear()
            
    def end_task(self, task_id):
        task = self.streams.get(task_id)
        if not task:
            return
        with task["lock"]:
            task["done"] = True
        task["event"].set()  # Wake up consumers so they see done=True
            
    def mark_error(self, task_id, error_msg):
        task = self.streams.get(task_id)
        if not task:
            return
        with task["lock"]:
            task["error"] = error_msg
            task["done"] = True
        task["event"].set()
            
    def cleanup_task(self, task_id):
        """Called after a consumer has fully drained a completed task."""
        self.streams.pop(task_id, None)
    
    def get_task(self, task_id):
        return self.streams.get(task_id)

    def iter_chunks(self, task_id):
        """
        Generator that yields all chunks for a task, including past ones.
        Blocks waiting for new chunks. Returns when task is done.
        
        This is the key method: a reconnecting client calls this and gets
        ALL chunks from the beginning, then continues receiving live ones.
        """
        task = self.streams.get(task_id)
        if not task:
            return
            
        pos = 0  # Read position in the chunks list
        
        while True:
            with task["lock"]:
                # Yield any new chunks since our last position
                while pos < len(task["chunks"]):
                    yield task["chunks"][pos]
                    pos += 1
                    
                # Check if the task is done
                if task["done"]:
                    if task["error"]:
                        yield f"ERROR:{task['error']}"
                    return
            
            # Wait for new chunks or task completion (with timeout to avoid deadlocks)
            task["event"].wait(timeout=1.0)

task_manager = TaskManager()

def run_generator_in_background(app, task_id, generator_func, *args, **kwargs):
    def worker():
        with app.app_context():
            try:
                for chunk in generator_func(*args, **kwargs):
                    task_manager.push_chunk(task_id, chunk)
            except Exception as e:
                import traceback
                traceback.print_exc()
                task_manager.mark_error(task_id, str(e))
            finally:
                task_manager.end_task(task_id)
                
    threading.Thread(target=worker, daemon=True).start()
