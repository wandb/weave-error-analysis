/**
 * Frontend Logging Utility
 * 
 * Provides structured logging with consistent formatting, secret masking,
 * and optional error transport to backend.
 * 
 * Usage:
 *   import { createLogger } from '@/app/lib/logger';
 *   
 *   const logger = createLogger('Settings');
 *   logger.info('setting.saved', { key: 'llm_model', value: 'gpt-4o' });
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  correlationId?: string;
  [key: string]: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

// Set via environment variable (default: info in production, debug in development)
const MIN_LEVEL = (process.env.NEXT_PUBLIC_LOG_LEVEL || 
  (process.env.NODE_ENV === 'development' ? 'debug' : 'info')) as LogLevel;

// Optional: send errors to backend
const SEND_ERRORS = process.env.NEXT_PUBLIC_SEND_ERRORS === 'true';

// Patterns that indicate sensitive values to mask
const SECRET_KEYS = ['key', 'token', 'secret', 'password', 'auth', 'credential', 'bearer'];

/**
 * Mask values for keys that look like secrets.
 */
function maskSecrets(context: LogContext): LogContext {
  const masked: LogContext = {};
  for (const [k, v] of Object.entries(context)) {
    if (SECRET_KEYS.some(s => k.toLowerCase().includes(s))) {
      masked[k] = '***';
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      masked[k] = maskSecrets(v as LogContext);
    } else {
      masked[k] = v;
    }
  }
  return masked;
}

/**
 * Generate a short correlation ID for tracing.
 */
export function generateCorrelationId(): string {
  return Math.random().toString(36).substring(2, 14);
}

class Logger {
  constructor(private component: string) {}

  private log(level: LogLevel, event: string, context?: LogContext) {
    if (LOG_LEVELS[level] < LOG_LEVELS[MIN_LEVEL]) return;

    const safeContext = context ? maskSecrets(context) : {};
    const timestamp = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
    const prefix = `${timestamp} | ${level.toUpperCase().padEnd(5)} | ${this.component}`;
    
    // Format context as key=value pairs for readability
    const contextPairs = Object.entries(safeContext)
      .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(' ');
    
    const message = contextPairs ? `${prefix} | ${event} | ${contextPairs}` : `${prefix} | ${event}`;

    // Use appropriate console method
    const logFn = console[level] || console.log;
    logFn(message);

    // Optional: send errors to backend for aggregation
    if (SEND_ERRORS && level === 'error') {
      this.sendToBackend(event, safeContext);
    }
  }

  /**
   * Fire-and-forget error reporting to backend.
   * Doesn't block or throw - logging should never break the app.
   */
  private sendToBackend(event: string, context: LogContext) {
    try {
      fetch('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event,
          context,
          component: this.component,
          timestamp: new Date().toISOString(),
          url: typeof window !== 'undefined' ? window.location.href : undefined
        })
      }).catch(() => {}); // Silent fail - logging shouldn't break the app
    } catch {
      // Ignore errors
    }
  }

  debug(event: string, context?: LogContext) { this.log('debug', event, context); }
  info(event: string, context?: LogContext) { this.log('info', event, context); }
  warn(event: string, context?: LogContext) { this.log('warn', event, context); }
  error(event: string, context?: LogContext) { this.log('error', event, context); }
}

/**
 * Create a logger for a specific component.
 * 
 * @param component - Component name (e.g., 'Settings', 'SyntheticTab', 'API')
 * @returns Logger instance
 */
export const createLogger = (component: string) => new Logger(component);

