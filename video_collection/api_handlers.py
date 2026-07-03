from dataclasses import dataclass
from typing import Any

from video_collection.api_handlers_catalog import ApiCatalogHandlersMixin
from video_collection.api_handlers_integrations import ApiIntegrationHandlersMixin
from video_collection.api_handlers_maintenance import ApiMaintenanceHandlersMixin
from video_collection.api_handlers_media import ApiMediaHandlersMixin
from video_collection.api_handlers_movies import ApiMovieHandlersMixin


@dataclass(frozen=True)
class ApiHandlerDependencies:
    jsonify: Any
    json_error: Any
    json_exception: Any
    log_exception: Any
    get_db_connection: Any
    replace_movie_images: Any
    sync_movie_metadata: Any
    parse_image_filenames: Any
    normalize_upload_filename: Any
    delete_unreferenced_uploaded_images: Any
    parse_tag_names: Any
    parse_positive_int: Any
    resolve_tag_ids: Any
    resolve_rating_dimension_id: Any
    hydrate_movie_rows: Any
    access_token_required: Any
    get_csrf_token: Any
    api_event_metadata: Any
    get_service_url: Any
    emby_request: Any
    get_movie_image_filenames: Any
    get_database_upgrade_diagnostics: Any
    check_database_connection: Any
    logger: Any
    get_scheduled_backup_status: Any
    list_database_backups: Any
    backup_feature_enabled: Any
    db_maintenance_lock: Any
    run_database_backup: Any
    database_upgrade_command_hint: Any
    database_upgrade_required_error: Any
    safe_backup_filename: Any
    get_backup_file_path: Any
    run_backup_restore: Any
    delete_database_backup_file: Any
    normalize_video_relative_path: Any
    get_video_library_abs_path: Any
    allowed_video_file: Any
    format_video_file_item: Any
    allowed_file: Any
    process_image: Any
    get_upload_file_path: Any
    get_upload_folder: Any


class ApiHandlers(
    ApiMovieHandlersMixin,
    ApiCatalogHandlersMixin,
    ApiIntegrationHandlersMixin,
    ApiMaintenanceHandlersMixin,
    ApiMediaHandlersMixin,
):
    def __init__(self, dependencies: ApiHandlerDependencies):
        self.dependencies = dependencies


__all__ = ['ApiHandlerDependencies', 'ApiHandlers']