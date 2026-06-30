from app import app, initialize_application


if not initialize_application(startup_debug_enabled=False):
    raise RuntimeError('Application initialization failed')


application = app
