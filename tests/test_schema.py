import app as app_module
from video_collection import schema


class FakeCursor:
    def __init__(self, tags_count=0, ratings_count=0):
        self.executed = []
        self.fetchone_values = [(tags_count,), (ratings_count,)]

    def execute(self, sql, params=None):
        self.executed.append((sql, params))

    def fetchone(self):
        return self.fetchone_values.pop(0)


class FakeConnection:
    def __init__(self, cursor):
        self._cursor = cursor
        self.commit_count = 0

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def cursor(self):
        return self._cursor

    def commit(self):
        self.commit_count += 1


def run_schema_initialization(cursor):
    connection = FakeConnection(cursor)
    ensure_index_calls = []
    migration_calls = []

    def ensure_index(cursor_arg, table_name, index_name, create_sql):
        ensure_index_calls.append((cursor_arg, table_name, index_name, create_sql))

    def migrate_metadata(conn_arg, cursor_arg):
        migration_calls.append(('metadata', conn_arg, cursor_arg))

    def migrate_images(conn_arg, cursor_arg):
        migration_calls.append(('images', conn_arg, cursor_arg))

    result = schema.initialize_database(
        lambda: connection,
        app_module.logger,
        ensure_index,
        migrate_metadata,
        migrate_images
    )
    return result, connection, ensure_index_calls, migration_calls


def test_schema_initialization_creates_tables_indexes_defaults_and_runs_migrations():
    cursor = FakeCursor(tags_count=0, ratings_count=0)

    result, connection, ensure_index_calls, migration_calls = run_schema_initialization(cursor)

    create_table_sql = [sql for sql, _ in cursor.executed if 'CREATE TABLE IF NOT EXISTS' in sql]
    tag_inserts = [params[0] for sql, params in cursor.executed if sql == "INSERT INTO tags (name) VALUES (%s)"]
    dimension_inserts = [
        params[0]
        for sql, params in cursor.executed
        if sql == "INSERT INTO ratings_dimensions (name) VALUES (%s)"
    ]

    assert result is True
    assert len(create_table_sql) == len(schema.CORE_TABLES) == 7
    assert [call[2] for call in ensure_index_calls] == [index[1] for index in schema.CORE_INDEXES]
    assert tag_inserts == list(schema.DEFAULT_TAGS)
    assert dimension_inserts == list(schema.DEFAULT_RATING_DIMENSIONS)
    assert [call[0] for call in migration_calls] == ['metadata', 'images']
    assert connection.commit_count == 1


def test_schema_initialization_does_not_seed_defaults_when_tables_have_rows():
    cursor = FakeCursor(tags_count=1, ratings_count=1)

    run_schema_initialization(cursor)

    inserted_sql = [sql for sql, _ in cursor.executed if sql.startswith('INSERT INTO')]
    assert inserted_sql == []


def test_init_db_returns_false_when_schema_initialization_fails(monkeypatch):
    logged = []

    def fail_initialization(*args, **kwargs):
        raise RuntimeError('boom')

    monkeypatch.setattr(app_module.schema, 'initialize_database', fail_initialization)
    monkeypatch.setattr(app_module, 'log_exception', lambda action, exc: logged.append((action, exc)))

    assert app_module.init_db() is False
    assert logged
    assert logged[0][0] == 'Database initialization'
