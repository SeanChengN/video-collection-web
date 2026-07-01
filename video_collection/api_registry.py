API_EVENTS = {}


def api_event(name, handler, methods=('POST',), require_csrf=True):
    return {
        'name': name,
        'handler': handler,
        'methods': {method.upper() for method in methods},
        'require_csrf': require_csrf
    }


def normalize_api_event_id(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def normalize_api_method(value):
    method = str(value or 'POST').strip().upper()
    return method or 'POST'


def api_event_metadata():
    return {
        str(event_id): {
            'name': event['name'],
            'methods': sorted(event['methods'])
        }
        for event_id, event in sorted(API_EVENTS.items())
    }

