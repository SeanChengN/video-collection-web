from datetime import datetime

import app as app_module


class HydrateCursor:
    def __init__(self):
        self.executed = []
        self.fetchall_results = [
            [
                {'movie_title': 'Movie A', 'name': 'Action'},
                {'movie_title': 'Movie A', 'name': 'Drama'},
            ],
            [
                {
                    'movie_title': 'Movie A',
                    'dimension_id': 1,
                    'dimension_name': 'Story',
                    'rating': 5
                },
            ],
            [
                {'movie_title': 'Movie A', 'filename': 'cover.webp'},
                {'movie_title': 'Movie A', 'filename': '2026/still.jpg'},
            ],
        ]

    def execute(self, sql, params=None):
        self.executed.append((sql, params))

    def fetchall(self):
        return self.fetchall_results.pop(0)


def test_metadata_parsers_filter_invalid_and_duplicate_values():
    assert app_module.parse_tag_names('Action, Drama, Action, , Drama') == ['Action', 'Drama']
    assert app_module.parse_ratings_string('1:5, 2:0, x:3, 1:4, 3:6, 4:2') == [(1, 4), (4, 2)]
    assert app_module.parse_image_filenames(
        '../bad.webp, cover.webp, 2026/still.jpg, cover.webp, poster.gif'
    ) == ['cover.webp', '2026/still.jpg']


def test_hydrate_movie_rows_adds_tags_ratings_images_and_formatted_date():
    cursor = HydrateCursor()
    movies = [{
        'title': 'Movie A',
        'recommended': 1,
        'review': 'Good',
        'added_date': datetime(2026, 7, 2, 10, 30, 0),
    }]

    hydrated = app_module.hydrate_movie_rows(cursor, movies)

    assert hydrated is movies
    assert movies[0]['tag_names'] == 'Action, Drama'
    assert movies[0]['ratings'] == '1:5'
    assert movies[0]['ratings_display'] == {'Story': 5}
    assert movies[0]['image_filename'] == 'cover.webp,2026/still.jpg'
    assert movies[0]['formatted_added_date'] == '2026-07-02 10:30:00'
    assert len(cursor.executed) == 3
