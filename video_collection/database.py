import os
from contextlib import contextmanager

import mysql.connector


def build_db_config(environ=None):
    environ = environ or os.environ
    return {
        "host": environ["DB_HOST"],
        "user": environ["DB_USER"],
        "password": environ["DB_PASSWORD"],
        "database": environ["DB_DATABASE"]
    }


@contextmanager
def get_db_connection(db_config):
    conn = mysql.connector.connect(**db_config)
    try:
        yield conn
    finally:
        if conn.is_connected():
            conn.close()


def first_column_value(row):
    if isinstance(row, dict):
        return next(iter(row.values()))
    return row[0]


def check_database_connection(connection_factory):
    with connection_factory() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT 1")
        result = cursor.fetchone()
        return first_column_value(result) == 1
