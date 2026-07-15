from .uploads import normalize_upload_filename as default_normalize_upload_filename


MOVIE_METADATA_MIGRATION = '2026_06_18_normalize_movie_metadata'
MOVIE_IMAGES_MIGRATION = '2026_06_21_normalize_movie_images'
MOVIE_EMBY_LINK_MIGRATION = '2026_07_15_add_movie_emby_link'


def table_exists(cursor, table_name):
    cursor.execute("""
        SELECT COUNT(*)
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s
    """, (table_name,))
    return cursor.fetchone()[0] > 0


def column_exists(cursor, table_name, column_name):
    cursor.execute("""
        SELECT COUNT(*)
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = %s
          AND COLUMN_NAME = %s
    """, (table_name, column_name))
    return cursor.fetchone()[0] > 0


def index_exists(cursor, table_name, index_name):
    cursor.execute("""
        SELECT COUNT(*)
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = %s
          AND INDEX_NAME = %s
    """, (table_name, index_name))
    return cursor.fetchone()[0] > 0


def ensure_index(cursor, table_name, index_name, create_sql):
    if not index_exists(cursor, table_name, index_name):
        cursor.execute(create_sql)


def migration_recorded(cursor, version):
    cursor.execute(
        "SELECT 1 FROM schema_migrations WHERE version = %s LIMIT 1",
        (version,)
    )
    return cursor.fetchone() is not None


def record_schema_migration(cursor, version):
    cursor.execute(
        "INSERT IGNORE INTO schema_migrations (version) VALUES (%s)",
        (version,)
    )


def parse_legacy_id_list(value):
    ids = []
    seen = set()
    for item in str(value or '').split(','):
        item = item.strip()
        if not item:
            continue
        try:
            item_id = int(item)
        except (TypeError, ValueError):
            continue
        if item_id <= 0 or item_id in seen:
            continue
        seen.add(item_id)
        ids.append(item_id)
    return ids


def parse_tag_names(value):
    names = []
    seen = set()
    for item in str(value or '').split(','):
        name = item.strip()
        if not name or name in seen:
            continue
        seen.add(name)
        names.append(name)
    return names


def parse_ratings_string(value):
    ratings_by_dimension = {}
    for item in str(value or '').split(','):
        item = item.strip()
        if ':' not in item:
            continue
        dimension_id, rating = item.split(':', 1)
        try:
            dimension_id = int(dimension_id.strip())
            rating = int(rating.strip())
        except (TypeError, ValueError):
            continue
        if dimension_id <= 0 or rating < 1 or rating > 5:
            continue
        ratings_by_dimension[dimension_id] = rating
    return list(ratings_by_dimension.items())


def parse_image_filenames(value, filename_normalizer=default_normalize_upload_filename):
    filenames = []
    seen = set()
    for item in str(value or '').split(','):
        filename = filename_normalizer(item)
        if not filename or filename in seen:
            continue
        seen.add(filename)
        filenames.append(filename)
    return filenames


def parse_positive_int(value, default, minimum=1, maximum=None):
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    if number < minimum:
        return minimum
    if maximum is not None and number > maximum:
        return maximum
    return number


def row_value(row, key='id'):
    if isinstance(row, dict):
        return row.get(key)
    return row[0]


def first_row_value(row):
    if isinstance(row, dict):
        return next(iter(row.values()))
    return row[0]


def resolve_tag_ids(cursor, tag_names):
    tag_ids = []
    for tag_name in tag_names:
        cursor.execute("SELECT id FROM tags WHERE name = %s", (tag_name,))
        result = cursor.fetchone()
        if result:
            tag_ids.append(row_value(result))
    return tag_ids


def replace_movie_tags(cursor, movie_title, tag_ids):
    cursor.execute("DELETE FROM movie_tags WHERE movie_title = %s", (movie_title,))
    for tag_id in tag_ids:
        cursor.execute("""
            INSERT IGNORE INTO movie_tags (movie_title, tag_id)
            VALUES (%s, %s)
        """, (movie_title, tag_id))


def replace_movie_ratings(cursor, movie_title, ratings_value):
    cursor.execute("DELETE FROM movie_ratings WHERE movie_title = %s", (movie_title,))
    for dimension_id, rating in parse_ratings_string(ratings_value):
        cursor.execute("""
            INSERT INTO movie_ratings (movie_title, dimension_id, rating)
            SELECT %s, id, %s
            FROM ratings_dimensions
            WHERE id = %s
            ON DUPLICATE KEY UPDATE rating = VALUES(rating)
        """, (movie_title, rating, dimension_id))


def replace_movie_images(
    cursor,
    movie_title,
    image_filenames_value,
    filename_normalizer=default_normalize_upload_filename
):
    cursor.execute("DELETE FROM movie_images WHERE movie_title = %s", (movie_title,))
    for sort_order, filename in enumerate(parse_image_filenames(image_filenames_value, filename_normalizer)):
        cursor.execute("""
            INSERT INTO movie_images (movie_title, filename, sort_order)
            VALUES (%s, %s, %s)
            ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order)
        """, (movie_title, filename, sort_order))


def get_movie_image_filenames(cursor, movie_title):
    cursor.execute("""
        SELECT filename
        FROM movie_images
        WHERE movie_title = %s
        ORDER BY sort_order, filename
    """, (movie_title,))
    rows = cursor.fetchall()
    filenames = []
    for row in rows:
        filenames.append(row['filename'] if isinstance(row, dict) else row[0])
    return filenames


def delete_unreferenced_uploaded_images(
    cursor,
    filenames,
    filename_normalizer,
    delete_uploaded_image,
    logger
):
    for filename in filenames:
        safe_filename = filename_normalizer(filename)
        if not safe_filename:
            continue
        try:
            cursor.execute("SELECT COUNT(*) FROM movie_images WHERE filename = %s", (safe_filename,))
            if first_row_value(cursor.fetchone()) > 0:
                continue
            delete_uploaded_image(safe_filename)
        except Exception as e:
            logger.warning("Failed to delete unreferenced image %r: %s", safe_filename, e)


def sync_movie_metadata(cursor, movie_title, tag_names_value, ratings_value):
    tag_ids = resolve_tag_ids(cursor, parse_tag_names(tag_names_value))
    replace_movie_tags(cursor, movie_title, tag_ids)
    replace_movie_ratings(cursor, movie_title, ratings_value)


def hydrate_movie_rows(cursor, movies):
    if not movies:
        return movies

    titles = [movie['title'] for movie in movies]
    placeholders = ','.join(['%s'] * len(titles))

    cursor.execute(f"""
        SELECT mt.movie_title, t.name
        FROM movie_tags mt
        JOIN tags t ON t.id = mt.tag_id
        WHERE mt.movie_title IN ({placeholders})
        ORDER BY t.name
    """, titles)
    tags_by_title = {}
    for row in cursor.fetchall():
        tags_by_title.setdefault(row['movie_title'], []).append(row['name'])

    cursor.execute(f"""
        SELECT mr.movie_title, rd.id AS dimension_id, rd.name AS dimension_name, mr.rating
        FROM movie_ratings mr
        JOIN ratings_dimensions rd ON rd.id = mr.dimension_id
        WHERE mr.movie_title IN ({placeholders})
        ORDER BY rd.id
    """, titles)
    ratings_by_title = {}
    ratings_display_by_title = {}
    for row in cursor.fetchall():
        title = row['movie_title']
        dimension_id = int(row['dimension_id'])
        rating = int(row['rating'])
        ratings_by_title.setdefault(title, []).append((dimension_id, rating))
        ratings_display_by_title.setdefault(title, {})[row['dimension_name']] = rating

    cursor.execute(f"""
        SELECT movie_title, filename
        FROM movie_images
        WHERE movie_title IN ({placeholders})
        ORDER BY movie_title, sort_order, filename
    """, titles)
    images_by_title = {}
    for row in cursor.fetchall():
        images_by_title.setdefault(row['movie_title'], []).append(row['filename'])

    for movie in movies:
        title = movie['title']
        movie['image_filename'] = ','.join(images_by_title.get(title, []))
        movie['tag_names'] = ', '.join(tags_by_title.get(title, []))

        ratings = ratings_by_title.get(title, [])
        movie['ratings'] = ','.join(f"{dimension_id}:{rating}" for dimension_id, rating in ratings)
        movie['ratings_display'] = ratings_display_by_title.get(title, {})

        added_date = movie.get('added_date')
        if hasattr(added_date, 'strftime'):
            movie['formatted_added_date'] = added_date.strftime('%Y-%m-%d %H:%M:%S')
        else:
            movie['formatted_added_date'] = str(added_date or '')

    return movies


def resolve_rating_dimension_id(cursor, value):
    value = str(value or '').strip()
    if not value:
        return None

    if value.isdigit():
        cursor.execute("SELECT id FROM ratings_dimensions WHERE id = %s", (int(value),))
    else:
        cursor.execute("SELECT id FROM ratings_dimensions WHERE name = %s", (value,))
    result = cursor.fetchone()
    return row_value(result) if result else None


def migrate_movie_metadata_schema(conn, cursor, logger):
    has_legacy_tags = column_exists(cursor, 'movies', 'tags')
    has_legacy_ratings = column_exists(cursor, 'movies', 'ratings')

    if not has_legacy_tags and not has_legacy_ratings:
        if not migration_recorded(cursor, MOVIE_METADATA_MIGRATION):
            record_schema_migration(cursor, MOVIE_METADATA_MIGRATION)
        return

    logger.info("Migrating legacy movies tags/ratings columns to relation tables")

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS movies_legacy_backup (
            title VARCHAR(255) PRIMARY KEY,
            tags VARCHAR(255),
            ratings VARCHAR(255),
            backed_up_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    """)

    tags_expr = 'tags' if has_legacy_tags else 'NULL'
    ratings_expr = 'ratings' if has_legacy_ratings else 'NULL'
    cursor.execute(f"""
        INSERT INTO movies_legacy_backup (title, tags, ratings)
        SELECT title, {tags_expr}, {ratings_expr}
        FROM movies
        ON DUPLICATE KEY UPDATE
            tags = VALUES(tags),
            ratings = VALUES(ratings),
            backed_up_at = CURRENT_TIMESTAMP
    """)

    cursor.execute("SELECT id FROM tags")
    valid_tag_ids = {row[0] for row in cursor.fetchall()}
    cursor.execute("SELECT id FROM ratings_dimensions")
    valid_dimension_ids = {row[0] for row in cursor.fetchall()}

    cursor.execute("DELETE mt FROM movie_tags mt JOIN movies m ON m.title = mt.movie_title")
    cursor.execute("DELETE mr FROM movie_ratings mr JOIN movies m ON m.title = mr.movie_title")

    cursor.execute(f"SELECT title, {tags_expr} AS tags, {ratings_expr} AS ratings FROM movies")
    legacy_movies = cursor.fetchall()

    expected_tag_rows = 0
    expected_rating_rows = 0
    for title, legacy_tags, legacy_ratings in legacy_movies:
        tag_ids = [tag_id for tag_id in parse_legacy_id_list(legacy_tags) if tag_id in valid_tag_ids]
        for tag_id in tag_ids:
            cursor.execute("""
                INSERT IGNORE INTO movie_tags (movie_title, tag_id)
                VALUES (%s, %s)
            """, (title, tag_id))
        expected_tag_rows += len(tag_ids)

        ratings = [
            (dimension_id, rating)
            for dimension_id, rating in parse_ratings_string(legacy_ratings)
            if dimension_id in valid_dimension_ids
        ]
        for dimension_id, rating in ratings:
            cursor.execute("""
                INSERT INTO movie_ratings (movie_title, dimension_id, rating)
                VALUES (%s, %s, %s)
                ON DUPLICATE KEY UPDATE rating = VALUES(rating)
            """, (title, dimension_id, rating))
        expected_rating_rows += len(ratings)

    cursor.execute("SELECT COUNT(*) FROM movie_tags mt JOIN movies m ON m.title = mt.movie_title")
    actual_tag_rows = cursor.fetchone()[0]
    cursor.execute("SELECT COUNT(*) FROM movie_ratings mr JOIN movies m ON m.title = mr.movie_title")
    actual_rating_rows = cursor.fetchone()[0]

    if actual_tag_rows != expected_tag_rows or actual_rating_rows != expected_rating_rows:
        conn.rollback()
        raise RuntimeError(
            "Movie metadata migration validation failed: "
            f"tags {actual_tag_rows}/{expected_tag_rows}, "
            f"ratings {actual_rating_rows}/{expected_rating_rows}"
        )

    conn.commit()

    if has_legacy_tags:
        cursor.execute("ALTER TABLE movies DROP COLUMN tags")
    if has_legacy_ratings:
        cursor.execute("ALTER TABLE movies DROP COLUMN ratings")
    record_schema_migration(cursor, MOVIE_METADATA_MIGRATION)


def migrate_movie_images_schema(
    conn,
    cursor,
    logger,
    filename_normalizer=default_normalize_upload_filename
):
    has_legacy_image_filename = column_exists(cursor, 'movies', 'image_filename')

    if not has_legacy_image_filename:
        if not migration_recorded(cursor, MOVIE_IMAGES_MIGRATION):
            record_schema_migration(cursor, MOVIE_IMAGES_MIGRATION)
        return

    logger.info("Migrating legacy movies image_filename column to movie_images")

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS movies_image_legacy_backup (
            title VARCHAR(255) PRIMARY KEY,
            image_filename TEXT,
            backed_up_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    """)

    cursor.execute("""
        INSERT INTO movies_image_legacy_backup (title, image_filename)
        SELECT title, image_filename
        FROM movies
        ON DUPLICATE KEY UPDATE
            image_filename = VALUES(image_filename),
            backed_up_at = CURRENT_TIMESTAMP
    """)

    cursor.execute("DELETE mi FROM movie_images mi JOIN movies m ON m.title = mi.movie_title")
    cursor.execute("SELECT title, image_filename FROM movies")
    legacy_movies = cursor.fetchall()

    expected_image_rows = 0
    for title, legacy_image_filename in legacy_movies:
        filenames = parse_image_filenames(legacy_image_filename, filename_normalizer)
        for sort_order, filename in enumerate(filenames):
            cursor.execute("""
                INSERT INTO movie_images (movie_title, filename, sort_order)
                VALUES (%s, %s, %s)
                ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order)
            """, (title, filename, sort_order))
        expected_image_rows += len(filenames)

    cursor.execute("SELECT COUNT(*) FROM movie_images mi JOIN movies m ON m.title = mi.movie_title")
    actual_image_rows = cursor.fetchone()[0]

    if actual_image_rows != expected_image_rows:
        conn.rollback()
        raise RuntimeError(
            "Movie images migration validation failed: "
            f"images {actual_image_rows}/{expected_image_rows}"
        )

    conn.commit()

    cursor.execute("ALTER TABLE movies DROP COLUMN image_filename")
    record_schema_migration(cursor, MOVIE_IMAGES_MIGRATION)


def migrate_movie_emby_link_schema(conn, cursor, logger):
    if not column_exists(cursor, 'movies', 'emby_item_id'):
        logger.info("Adding Emby item link column to movies")
        cursor.execute("ALTER TABLE movies ADD COLUMN emby_item_id VARCHAR(128) NULL")
    if not migration_recorded(cursor, MOVIE_EMBY_LINK_MIGRATION):
        record_schema_migration(cursor, MOVIE_EMBY_LINK_MIGRATION)
