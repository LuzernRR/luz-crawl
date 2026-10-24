export class OperationError extends Error {
  constructor(code, message, details = {}) {
    super(message, details.cause ? { cause: details.cause } : undefined);
    this.name = 'OperationError';
    Object.assign(this, { code, retryable: false, outcome_unknown: false }, details);
    this.next_action ||= code === 'rate_limited' ? 'Wait for retry_after_ms; do not switch routes to avoid a cooldown.' : ['login_required', 'verification_required'].includes(code) ? 'Complete login or verification manually, then continue the saved task.' : this.outcome_unknown ? 'Read the current page to verify the effect before sending another write.' : this.retryable ? 'Retry this read within the configured attempt budget.' : 'Inspect the saved evidence and correct the target or input before continuing.';
  }
  toJSON() {
    const { code, message, retryable, outcome_unknown, status, retry_after_ms, next_action, attempts_exhausted } = this;
    return { code, message, retryable, outcome_unknown, status, retry_after_ms, next_action, attempts_exhausted };
  }
}

export function retryAfter(value, now = Date.now()) {
  if (value == null || value === '') return 0;
  const delay = /^\d+(?:\.\d+)?$/.test(String(value).trim()) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isSafeInteger(Math.ceil(delay)) && delay > 0 ? Math.ceil(delay) : 0;
}

export function classifyFailure(error, { idempotent = true } = {}) {
  if (error instanceof OperationError) {
    if (idempotent || !error.retryable) return error;
    return new OperationError(error.code, error.message, { ...error, retryable: false, outcome_unknown: true, next_action: undefined });
  }
  const message = error?.message || String(error);
  const status = error?.status ?? Number(message.match(/\bHTTP\s+(\d{3})\b/i)?.[1] || 0);
  let code = 'operation_failed';
  let transient = false;
  if (['command_result_unknown', 'command_lost', 'result_evicted'].includes(error?.code)) { code = idempotent ? 'transient_failure' : 'write_outcome_unknown'; transient = true; }
  else if (error?.name === 'AbortError') code = 'cancelled';
  else if (status === 429 || /rate.limit|too many requests|频繁|频率过高/i.test(message)) code = 'rate_limited';
  else if (status === 401 || /login_required|manual login|Password inputs|sign in required/i.test(message)) code = 'login_required';
  else if (/verification_required|verify you are human|captcha|安全验证/i.test(message)) code = 'verification_required';
  else if (status === 403) code = 'access_denied';
  else if (status === 404 || error?.code === 'ENOTFOUND') code = 'unavailable';
  else if (error?.name === 'TimeoutError' || [408, 425, 500, 502, 503, 504].includes(status) || ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED', 'EPIPE', 'UND_ERR_SOCKET'].includes(error?.code) || /timeout|timed out|connection (?:lost|closed)|Detached while handling command/i.test(message)) { code = 'transient_failure'; transient = true; }
  else if (/selector|ambiguous|disabled|unsupported|invalid|size limit|MIME|outside|escapes|verification failed|modified archive/i.test(message)) code = 'invalid_target';
  return new OperationError(code, message, {
    status: status || undefined, retryable: transient && idempotent,
    outcome_unknown: transient && !idempotent, cause: error,
    ...(error?.retry_after_ms ? { retry_after_ms: error.retry_after_ms } : {}),
  });
}

export function httpFailure(response) {
  return classifyFailure(Object.assign(new Error(`HTTP ${response.status}`), {
    status: response.status, retry_after_ms: retryAfter(response.headers?.get('retry-after')),
  }));
}
