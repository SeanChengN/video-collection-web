import mysql.connector


CORE_TABLES = (
    """
        CREATE TABLE IF NOT EXISTS movies (
            title VARCHAR(255) PRIMARY KEY,
            recommended BOOLEAN,
            review TEXT,
            added_date DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """,
    """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version VARCHAR(100) PRIMARY KEY,
            applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """,
    """
        CREATE TABLE IF NOT EXISTS tags (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(50) UNIQUE
        )
    """,
    """
        CREATE TABLE IF NOT EXISTS ratings_dimensions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(50) UNIQUE
        )
    """,
    """
        CREATE TABLE IF NOT EXISTS movie_tags (
            movie_title VARCHAR(255) NOT NULL,
            tag_id INT NOT NULL,
            PRIMARY KEY (movie_title, tag_id),
            CONSTRAINT fk_movie_tags_movie
                FOREIGN KEY (movie_title) REFERENCES movies(title)
                ON DELETE CASCADE ON UPDATE CASCADE,
            CONSTRAINT fk_movie_tags_tag
                FOREIGN KEY (tag_id) REFERENCES tags(id)
                ON DELETE CASCADE ON UPDATE CASCADE
        )
    """,
    """
        CREATE TABLE IF NOT EXISTS movie_ratings (
            movie_title VARCHAR(255) NOT NULL,
            dimension_id INT NOT NULL,
            rating TINYINT NOT NULL,
            PRIMARY KEY (movie_title, dimension_id),
            CONSTRAINT fk_movie_ratings_movie
                FOREIGN KEY (movie_title) REFERENCES movies(title)
                ON DELETE CASCADE ON UPDATE CASCADE,
            CONSTRAINT fk_movie_ratings_dimension
                FOREIGN KEY (dimension_id) REFERENCES ratings_dimensions(id)
                ON DELETE CASCADE ON UPDATE CASCADE,
            CONSTRAINT chk_movie_rating_range CHECK (rating BETWEEN 1 AND 5)
        )
    """,
    """
        CREATE TABLE IF NOT EXISTS movie_images (
            movie_title VARCHAR(255) NOT NULL,
            filename VARCHAR(255) NOT NULL,
            sort_order INT NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (movie_title, filename),
            CONSTRAINT fk_movie_images_movie
                FOREIGN KEY (movie_title) REFERENCES movies(title)
                ON DELETE CASCADE ON UPDATE CASCADE
        )
    """,
)


CORE_INDEXES = (
    ('movies', 'idx_movies_added_date', """
        CREATE INDEX idx_movies_added_date ON movies (added_date)
    """),
    ('movie_tags', 'idx_movie_tags_tag_movie', """
        CREATE INDEX idx_movie_tags_tag_movie ON movie_tags (tag_id, movie_title)
    """),
    ('movie_ratings', 'idx_movie_ratings_dimension_rating_title', """
        CREATE INDEX idx_movie_ratings_dimension_rating_title
        ON movie_ratings (dimension_id, rating, movie_title)
    """),
    ('movie_ratings', 'idx_movie_ratings_movie_rating', """
        CREATE INDEX idx_movie_ratings_movie_rating
        ON movie_ratings (movie_title, rating)
    """),
    ('movie_images', 'idx_movie_images_movie_sort', """
        CREATE INDEX idx_movie_images_movie_sort
        ON movie_images (movie_title, sort_order)
    """),
    ('movie_images', 'idx_movie_images_filename', """
        CREATE INDEX idx_movie_images_filename ON movie_images (filename)
    """),
)


DEFAULT_TAGS = (
    "精品", "剧情", "写实", "激烈", "抽象", "情感", "蒙面"
)


DEFAULT_RATING_DIMENSIONS = (
    "颜值", "身材", "皮肤", "表演", "画面", "剧情"
)


def create_core_tables(cursor):
    for create_sql in CORE_TABLES:
        cursor.execute(create_sql)


def create_core_indexes(cursor, ensure_index):
    for table_name, index_name, create_sql in CORE_INDEXES:
        ensure_index(cursor, table_name, index_name, create_sql)


def first_column_value(row):
    if isinstance(row, dict):
        return next(iter(row.values()))
    return row[0]


def insert_defaults_when_empty(cursor, table_name, insert_sql, values):
    cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
    if first_column_value(cursor.fetchone()) != 0:
        return

    for value in values:
        try:
            cursor.execute(insert_sql, (value,))
        except mysql.connector.Error as err:
            if err.errno != 1062:
                raise


def seed_default_metadata(cursor):
    insert_defaults_when_empty(
        cursor,
        'tags',
        "INSERT INTO tags (name) VALUES (%s)",
        DEFAULT_TAGS
    )
    insert_defaults_when_empty(
        cursor,
        'ratings_dimensions',
        "INSERT INTO ratings_dimensions (name) VALUES (%s)",
        DEFAULT_RATING_DIMENSIONS
    )


def initialize_database(
    connection_factory,
    logger,
    ensure_index,
    migrate_metadata_schema,
    migrate_images_schema
):
    with connection_factory() as conn:
        cursor = conn.cursor()
        create_core_tables(cursor)
        create_core_indexes(cursor, ensure_index)
        seed_default_metadata(cursor)
        migrate_metadata_schema(conn, cursor)
        migrate_images_schema(conn, cursor)
        conn.commit()
        return True
