import hmac
import os
import secrets
import time
from urllib.parse import urlsplit


def configured_access_token(environ=None):
    environ = environ or os.environ
    return environ.get('APP_ACCESS_TOKEN', '').strip()


def access_token_required(environ=None):
    return bool(configured_access_token(environ))


def configured_secret_key(environ=None):
    environ = environ or os.environ
    return environ.get('SECRET_KEY', '').strip()


def fallback_secret_key(access_token_is_required, logger):
    if access_token_is_required:
        logger.warning("SECRET_KEY is not configured; sessions will be invalidated on restart")
    return os.urandom(32)


def get_csrf_token(session_obj, session_key):
    token = session_obj.get(session_key)
    if not token:
        token = secrets.token_urlsafe(32)
        session_obj[session_key] = token
    return token


def request_csrf_token(request_obj):
    return request_obj.headers.get('X-CSRF-Token', '') or request_obj.form.get('csrf_token', '')


def csrf_token_is_valid(session_obj, request_obj, session_key):
    expected = session_obj.get(session_key, '')
    provided = request_csrf_token(request_obj)
    return bool(expected and provided and hmac.compare_digest(provided, expected))


def csrf_required_for_request(
    access_token_is_required,
    method,
    endpoint,
    safe_http_methods,
    exempt_endpoints=None
):
    exempt_endpoints = exempt_endpoints or set()
    return (
        access_token_is_required
        and method not in safe_http_methods
        and endpoint not in exempt_endpoints
    )


def auth_rate_limit_exceeded(
    failures_by_key,
    lock,
    attempts,
    window_seconds,
    key,
    now=None
):
    now = now or time.monotonic()
    cutoff = now - window_seconds
    with lock:
        failures = [stamp for stamp in failures_by_key.get(key, []) if stamp >= cutoff]
        failures_by_key[key] = failures
        return len(failures) >= attempts


def record_auth_failure(
    failures_by_key,
    lock,
    window_seconds,
    key,
    now=None
):
    now = now or time.monotonic()
    cutoff = now - window_seconds
    with lock:
        failures = [stamp for stamp in failures_by_key.get(key, []) if stamp >= cutoff]
        failures.append(now)
        failures_by_key[key] = failures


def clear_auth_failures(failures_by_key, lock, key):
    with lock:
        failures_by_key.pop(key, None)


def add_security_headers(response):
    response.headers.setdefault('X-Content-Type-Options', 'nosniff')
    response.headers.setdefault('X-Frame-Options', 'SAMEORIGIN')
    response.headers.setdefault('Referrer-Policy', 'same-origin')
    response.headers.setdefault('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    return response


def safe_next_path(value):
    value = (value or '/').strip()
    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc:
        return '/'
    if not parsed.path.startswith('/') or parsed.path.startswith('//'):
        return '/'
    return parsed.path + (f'?{parsed.query}' if parsed.query else '')
