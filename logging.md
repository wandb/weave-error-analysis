# Logging Strategy for Weave Error Analysis

A low-lift, high-impact logging strategy focused on visibility into LLM configuration, model usage, API keys, and execution flows.

---

## Current State

| Location | Current Approach | Issues |
|----------|-----------------|--------|
| Backend | Scattered `print()` statements | No structured format, no log levels |
| Frontend | Inconsistent `console.*` | No categorization, never leaves browser |
| LLM Calls | Silent failures with fallback | No visibility into which model/settings used |
| Settings Changes | No audit trail | Can't verify if settings took effect |

**Key Pain Points:**
- "I have no idea if a selected model from the UI is actually used"
- "If temperature is set, is it actually used?"
- "If an API key is set, is it used?"

---

## Design Decisions

### A. Structured Logs: Stable Message + Fields

**Don't** embed JSON in log messages. It's hard to parse in aggregation tools.

```python
# ❌ Bad: JSON embedded in message
logger.info(f"LLM config: {json.dumps({'model': model, 'has_key': True})}")

# ✅ Good: Stable message, data in extra fields
logger.info("llm.config_resolved", extra={"model": model, "has_api_key": True})
```

The pattern: **short, stable event name** + **structured data in `extra`**.

This works today with Python's `logging` and is trivially portable to structlog, Datadog, or any log aggregator later.

### B. Secret Masking

Use a comprehensive pattern list, not just "key":

```python
SECRET_PATTERNS = {'key', 'token', 'secret', 'bearer', 'auth', 'password', 'credential'}

def mask_secrets(data: dict) -> dict:
    """Mask values for keys that look like secrets."""
    return {
        k: "***" if any(p in k.lower() for p in SECRET_PATTERNS) else v 
        for k, v in data.items()
    }
```

**LLM Prompts/Responses:** These can leak user data. Default to logging metadata only (length, model used). Add an opt-in `LOG_LLM_CONTENT` env var for debugging:

```python
LOG_LLM_CONTENT = os.getenv("LOG_LLM_CONTENT", "false").lower() == "true"

# In LLM logging:
if LOG_LLM_CONTENT:
    extra["prompt_preview"] = prompt[:200]
    extra["response_preview"] = response[:200]
```

### C. Canonical Correlation ID

Pick one: `correlation_id`. Generate it at the API boundary. Pass it everywhere.

```python
# At request entry (middleware or endpoint)
correlation_id = request.headers.get("X-Correlation-ID") or generate_id()[:12]

# Pass through context
extra = {"correlation_id": correlation_id, "batch_id": batch_id, ...}
```

Other IDs (`batch_id`, `query_id`, `trace_id`) are additional context, but `correlation_id` ties everything together.

For the frontend, include the same ID in headers:
```typescript
headers: { "X-Correlation-ID": correlationId }
```

### D. Log Volume & Environment Levels

| Environment | Min Level | Notes |
|-------------|-----------|-------|
| **Production** | `WARNING` | Errors and recoverable issues only |
| **Staging** | `INFO` | Business events, no per-query noise |
| **Development** | `DEBUG` | Everything |

**Batch operations:** Log aggregated stats, not per-item:

```python
# ❌ Noisy: logs 100 times for 100 queries
for query in queries:
    logger.debug(f"Executing query {query.id}")

# ✅ Better: log start, periodic progress, end
logger.info("batch.execution_started", extra={"batch_id": id, "total": 100})
# Every 10% or every 30s:
logger.info("batch.execution_progress", extra={"completed": 50, "total": 100})
logger.info("batch.execution_complete", extra={"success": 95, "failed": 5})
```

### E. Python Logging with FastAPI/Uvicorn

`logging.basicConfig()` only works if no handlers exist. Uvicorn sets up its own. Use explicit configuration:

```python
# backend/logger.py
import logging
import os

def setup_logging():
    """Configure logging explicitly (uvicorn-safe)."""
    log_level = os.getenv("LOG_LEVEL", "INFO").upper()
    
    # Create our handler
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter(
        '%(asctime)s | %(levelname)-7s | %(name)s | %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    ))
    
    # Configure root logger for our namespace
    root = logging.getLogger("weave")
    root.setLevel(getattr(logging, log_level, logging.INFO))
    root.addHandler(handler)
    root.propagate = False  # Don't duplicate to uvicorn's handler

def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(f"weave.{name}")
```

Call `setup_logging()` once in `main.py` at startup.

### F. Frontend: Optional Error Transport

Console logs are fine for dev, but critical errors should reach the backend:

```typescript
// Add transport hook for future use
private sendToBackend(level: LogLevel, message: string, context?: LogContext) {
  if (level !== 'error') return;
  
  // Fire-and-forget to avoid blocking
  fetch('/api/logs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      level,
      message,
      context,
      timestamp: new Date().toISOString(),
      url: window.location.href
    })
  }).catch(() => {}); // Silent fail - logging shouldn't break the app
}
```

This is **optional** for v1. The hook is there when you need it.

---

## Implementation

### Backend: `logger.py`

```python
# backend/logger.py
import logging
import os
from typing import Any, Dict

SECRET_PATTERNS = {'key', 'token', 'secret', 'bearer', 'auth', 'password', 'credential'}
LOG_LLM_CONTENT = os.getenv("LOG_LLM_CONTENT", "false").lower() == "true"

def setup_logging():
    """Configure logging explicitly (uvicorn-safe)."""
    log_level = os.getenv("LOG_LEVEL", "INFO").upper()
    
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter(
        '%(asctime)s | %(levelname)-7s | %(name)s | %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    ))
    
    root = logging.getLogger("weave")
    root.setLevel(getattr(logging, log_level, logging.INFO))
    root.addHandler(handler)
    root.propagate = False

def get_logger(name: str) -> logging.Logger:
    """Get a namespaced logger."""
    return logging.getLogger(f"weave.{name}")

def mask_secrets(data: Dict[str, Any]) -> Dict[str, Any]:
    """Mask values for keys that look like secrets."""
    return {
        k: "***" if any(p in k.lower() for p in SECRET_PATTERNS) else v 
        for k, v in data.items()
    }

def log_event(logger: logging.Logger, event: str, level: str = "info", **kwargs):
    """
    Log a structured event with masked secrets.
    
    Usage:
        log_event(logger, "llm.request_complete", model="gpt-4o", duration_ms=1200)
    """
    safe_data = mask_secrets(kwargs)
    log_fn = getattr(logger, level.lower(), logger.info)
    log_fn(event, extra=safe_data)
```

### Key Logging Points

**1. LLM Config Resolution** (`services/settings.py`)

```python
from logger import get_logger, log_event

logger = get_logger("settings")

def get_litellm_kwargs() -> Dict[str, Any]:
    model = get_setting("llm_model", "gpt-4o-mini")
    api_key = get_setting("llm_api_key")
    api_base = get_setting("llm_api_base")
    
    # This is the key log - answers "is my model being used?"
    log_event(logger, "llm.config_resolved",
        model=model,
        has_api_key=bool(api_key),
        api_key_source="settings" if api_key else "environment",
        api_base=api_base or "default"
    )
    
    kwargs = {"model": model}
    if api_key:
        kwargs["api_key"] = api_key
    if api_base:
        kwargs["api_base"] = api_base
    return kwargs
```

**2. LLM Calls** (`services/synthetic.py`)

```python
from logger import get_logger, log_event, LOG_LLM_CONTENT

logger = get_logger("synthetic")

async def tuple_to_query(self, dimension_tuple: DimensionTuple, use_llm: bool = True) -> str:
    llm_kwargs = get_litellm_kwargs()
    
    extra = {
        "operation": "query_generation",
        "model": llm_kwargs.get("model"),
        "tuple_id": dimension_tuple.id
    }
    
    log_event(logger, "llm.request_start", **extra)
    
    try:
        response = await acompletion(messages=[...], **llm_kwargs)
        
        log_event(logger, "llm.request_complete",
            **extra,
            actual_model=response.model,  # What the API actually used
            response_chars=len(response.choices[0].message.content)
        )
        return response.choices[0].message.content.strip()
        
    except Exception as e:
        log_event(logger, "llm.request_failed", level="warning",
            **extra,
            error=str(e),
            fallback="template"
        )
        return self.tuple_to_query_template(dimension_tuple)
```

**3. Batch Execution** (`services/batch_executor.py`)

```python
from logger import get_logger, log_event

logger = get_logger("batch")

class BatchExecutor:
    async def execute(self):
        log_event(logger, "batch.execution_started",
            correlation_id=self.correlation_id,
            batch_id=self.batch_id,
            endpoint=self.agent_endpoint,
            total_queries=len(queries),
            max_concurrent=self.max_concurrent
        )
        
        # Progress logging every N queries or every M seconds
        if completed % 10 == 0:
            log_event(logger, "batch.execution_progress",
                correlation_id=self.correlation_id,
                batch_id=self.batch_id,
                completed=completed,
                total=total
            )
        
        log_event(logger, "batch.execution_complete",
            correlation_id=self.correlation_id,
            batch_id=self.batch_id,
            success_count=success,
            failure_count=failed,
            duration_ms=duration
        )
```

**4. Agent Communication** (`services/agui_client.py`)

```python
from logger import get_logger, log_event

logger = get_logger("agent")

async def run(self, message: str, correlation_id: str = None, ...):
    log_event(logger, "agent.request_start",
        correlation_id=correlation_id,
        endpoint=self.endpoint_url,
        message_length=len(message)
    )
    
    # On completion
    log_event(logger, "agent.request_complete",
        correlation_id=correlation_id,
        trace_id=event.trace_id,
        thread_id=event.thread_id
    )
    
    # On error
    log_event(logger, "agent.request_failed", level="error",
        correlation_id=correlation_id,
        error=event.error
    )
```

### Frontend: `logger.ts`

```typescript
// frontend/src/app/lib/logger.ts

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  correlationId?: string;
  [key: string]: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0, info: 1, warn: 2, error: 3
};

const MIN_LEVEL = (process.env.NEXT_PUBLIC_LOG_LEVEL || 'info') as LogLevel;
const SEND_ERRORS = process.env.NEXT_PUBLIC_SEND_ERRORS === 'true';

// Patterns to mask in logs
const SECRET_KEYS = ['key', 'token', 'secret', 'password', 'auth'];

function maskSecrets(context: LogContext): LogContext {
  const masked: LogContext = {};
  for (const [k, v] of Object.entries(context)) {
    masked[k] = SECRET_KEYS.some(s => k.toLowerCase().includes(s)) ? '***' : v;
  }
  return masked;
}

class Logger {
  constructor(private component: string) {}

  private log(level: LogLevel, event: string, context?: LogContext) {
    if (LOG_LEVELS[level] < LOG_LEVELS[MIN_LEVEL]) return;

    const safeContext = context ? maskSecrets(context) : {};
    const timestamp = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
    const prefix = `${timestamp} | ${level.toUpperCase().padEnd(5)} | ${this.component}`;
    
    const logFn = console[level] || console.log;
    logFn(`${prefix} | ${event}`, safeContext);

    // Optional: send errors to backend
    if (SEND_ERRORS && level === 'error') {
      this.sendToBackend(event, safeContext);
    }
  }

  private sendToBackend(event: string, context: LogContext) {
    fetch('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event,
        context,
        component: this.component,
        timestamp: new Date().toISOString(),
        url: window.location.href
      })
    }).catch(() => {}); // Silent fail
  }

  debug(event: string, context?: LogContext) { this.log('debug', event, context); }
  info(event: string, context?: LogContext) { this.log('info', event, context); }
  warn(event: string, context?: LogContext) { this.log('warn', event, context); }
  error(event: string, context?: LogContext) { this.log('error', event, context); }
}

export const createLogger = (component: string) => new Logger(component);
```

**Usage in components:**

```typescript
const logger = createLogger('Settings');

// When saving a setting
logger.info('setting.save_started', { key, correlationId });
logger.info('setting.save_complete', { key });
logger.error('setting.save_failed', { key, error: String(e) });
```

---

## Sample Output

After implementation, logs tell a clear story:

```
2025-12-08 14:32:01 | INFO    | weave.settings | llm.config_resolved | model=gpt-4o-mini has_api_key=True api_key_source=settings
2025-12-08 14:32:01 | INFO    | weave.synthetic | llm.request_start | operation=query_generation model=gpt-4o-mini tuple_id=abc123
2025-12-08 14:32:02 | INFO    | weave.synthetic | llm.request_complete | actual_model=gpt-4o-mini-2024-07-18 response_chars=142
2025-12-08 14:32:05 | INFO    | weave.batch | batch.execution_started | correlation_id=a1b2c3 batch_id=xyz total_queries=100
2025-12-08 14:32:15 | INFO    | weave.batch | batch.execution_progress | correlation_id=a1b2c3 completed=50 total=100
2025-12-08 14:32:25 | INFO    | weave.batch | batch.execution_complete | correlation_id=a1b2c3 success_count=98 failure_count=2
```

**What this tells you:**
- ✅ Model `gpt-4o-mini` was requested and the API used `gpt-4o-mini-2024-07-18`
- ✅ API key came from settings (not environment)
- ✅ Batch execution touched 100 queries, 98 succeeded
- ✅ All events for this flow share `correlation_id=a1b2c3`

---

## Quick Wins (Implement Today)

If you want immediate visibility with minimal code:

```python
# backend/services/settings.py - in get_litellm_kwargs()
print(f"[LLM-CONFIG] model={model} api_key={'present' if api_key else 'MISSING'} source={'settings' if api_key else 'env'}")

# backend/services/synthetic.py - before acompletion()
print(f"[LLM-CALL] → {llm_kwargs.get('model')}")
# After response:
print(f"[LLM-CALL] ← {response.model} ({len(content)} chars)")

# backend/services/batch_executor.py - at execute() start
print(f"[BATCH] {batch_id} starting: {len(queries)} queries → {endpoint}")
```

These three print statements answer the core questions immediately.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `INFO` | Minimum log level: DEBUG, INFO, WARNING, ERROR |
| `LOG_LLM_CONTENT` | `false` | Log prompt/response previews (privacy risk!) |
| `NEXT_PUBLIC_LOG_LEVEL` | `info` | Frontend minimum log level |
| `NEXT_PUBLIC_SEND_ERRORS` | `false` | Send frontend errors to backend |

---

## Migration Path

1. **Today:** Add the 3 quick-win print statements
2. **Week 1:** Create `backend/logger.py`, add to settings & LLM calls
3. **Week 2:** Add correlation_id, update batch executor
4. **Later:** Frontend logger, error transport, log aggregation
