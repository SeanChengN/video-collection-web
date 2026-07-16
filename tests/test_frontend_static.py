import re
from pathlib import Path


FRONTEND_SOURCE_DIR = Path(__file__).resolve().parents[1] / "src" / "main"
INDEX_TEMPLATE = Path(__file__).resolve().parents[1] / "templates" / "index.html"
STYLE_SOURCE_DIR = Path(__file__).resolve().parents[1] / "src" / "styles"
SPRITE_SVG = Path(__file__).resolve().parents[1] / "static" / "sprite.svg"
THEME_OVERRIDE_FILE = STYLE_SOURCE_DIR / "system" / "10-themes.css"
FORBIDDEN_DOM_HTML_PATTERN = re.compile(
    r"\.(?:innerHTML|outerHTML)\b|\.insertAdjacentHTML\b"
)
HARDCODED_SVG_FILL_PATTERN = re.compile(r'fill="#[0-9a-fA-F]{3,8}"')
HARDCODED_THEME_COLOR_PATTERN = re.compile(
    r"#[0-9a-fA-F]{3,8}\b|(?<![-\w])(?:white|black)(?![-\w])|rgba?\(",
    re.IGNORECASE,
)
THEME_CRITICAL_SELECTORS = (
    ".modal-card-title",
    ".modal-control-button",
    ".dropdown-content",
    ".dropdown-menu",
    ".pagination-link",
    ".pagination-previous",
    ".pagination-next",
    ".results-count-summary",
    ".movie-results-count",
    ".emby-results-count",
    ".button.settings-btn",
    ".button.search-btn",
    ".button.save-btn",
    ".button.save-btn-small",
    ".button.add-btn",
    ".button.edit-btn",
    ".button.delete-btn",
    ".button.dupStart-btn",
    ".settings-modal .button.settings-delete-btn",
    ".settings-modal .button.maintenance-backup-delete-btn",
    ".settings-modal .button.maintenance-backup-restore-btn",
    ".settings-modal .button.maintenance-create-btn",
    ".maintenance-create-btn",
    ".theme-switch",
    ".theme-switch-slider",
    ".navbar-theme-switch",
    ".runtime-badge",
    ".movie-result-card",
    ".emby-playable-card",
    ".dupStart-btn",
    ".tags-filter .tag",
    ".tags-box .tag",
    "#add-tags .tag",
    "#edit-tags .tag",
    "#search-results .movie-results-grid",
    "#search-results .movie-result-card",
    ".movie-result-card.is-recommended",
    ".movie-card-recommend-badge",
    ".movie-card-edit-btn",
    ".settings-modal .table",
    "#tagsList tr:hover",
    "#ratingsList tr:hover",
    "#dbBackupsList tr:hover",
    "#duplicate-table .table",
    "tr.is-duplicate",
    ".settings-tabs li",
    ".settings-tabs a",
    ".settings-list-item",
    ".thumbnail-file-row",
    ".thumbnail-source-tabs",
    ".thumbnail-source-tabs .button.is-small[aria-pressed=\"true\"]",
    ".thumbnail-batch-section",
    ".thumbnail-manual-grid",
    ".wtl-screenshot-action",
    ".wtl-screenshot-item",
    ".wtl-screenshot-check",
    ".wtl-status-panel",
    ".wtl-status-dot",
    ".thumbnail-item-time",
    ".image-viewer-strip",
    ".image-viewer-thumb",
    ".image-box-title",
    ".ratings-box-title",
    ".tags-box-title",
    ".vc-rating-list",
    ".vc-rating-item",
    ".vc-rating-name",
    ".vc-rating-stars",
    ".rating-item",
    ".dimension-name",
    ".wtl-result-info",
    ".wtl-screenshots-title",
)
FIXED_ACTION_TOKENS = (
    "--vc-action-primary",
    "--vc-action-primary-glow",
    "--vc-action-primary-shadow",
    "--vc-action-success",
    "--vc-action-success-glow",
    "--vc-action-success-shadow",
    "--vc-action-danger",
    "--vc-action-danger-glow",
    "--vc-action-danger-shadow",
    "--vc-action-warning",
    "--vc-action-warning-glow",
    "--vc-action-warning-shadow",
    "--vc-action-settings",
    "--vc-action-settings-glow",
    "--vc-action-settings-shadow",
    "--vc-action-button-shine",
    "--vc-duplicate-start-bg",
    "--vc-duplicate-start-glow",
    "--vc-duplicate-start-shadow",
    "--vc-duplicate-start-active-shadow",
    "--vc-duplicate-start-shine",
    "--vc-duplicate-start-point",
)
THEME_SOURCE_FILES = (
    STYLE_SOURCE_DIR / "10-services-tools.css",
    STYLE_SOURCE_DIR / "20-thumbnail.css",
    STYLE_SOURCE_DIR / "30-controls-ratings.css",
    STYLE_SOURCE_DIR / "40-images-rating-cells.css",
    STYLE_SOURCE_DIR / "50-modals-results.css",
    STYLE_SOURCE_DIR / "60-settings.css",
    STYLE_SOURCE_DIR / "70-search-effects-alerts.css",
    STYLE_SOURCE_DIR / "system" / "30-components.css",
    STYLE_SOURCE_DIR / "system" / "20-bulma-bridge.css",
    INDEX_TEMPLATE,
)


def test_frontend_source_avoids_html_string_injection():
    offenders = []
    for path in sorted(FRONTEND_SOURCE_DIR.rglob("*.js")):
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if FORBIDDEN_DOM_HTML_PATTERN.search(line):
                offenders.append(f"{path.relative_to(FRONTEND_SOURCE_DIR.parents[1])}:{line_number}: {line.strip()}")

    assert offenders == []


def test_index_template_uses_themeable_svg_fills():
    content = INDEX_TEMPLATE.read_text(encoding="utf-8")
    assert HARDCODED_SVG_FILL_PATTERN.search(content) is None


def test_theme_critical_selectors_use_tokens_for_colors():
    offenders = []

    for path in THEME_SOURCE_FILES:
        content = path.read_text(encoding="utf-8")
        search_start = 0
        for block in content.split("}"):
            block_index = content.find(block, search_start)
            search_start = block_index + len(block) + 1
            if "{" not in block:
                continue
            selector, declarations = block.split("{", 1)
            if not any(target in selector for target in THEME_CRITICAL_SELECTORS):
                continue
            block_start = content[:block_index].count("\n") + 1
            for offset, line in enumerate(declarations.splitlines(), start=1):
                stripped = line.strip()
                if not stripped or stripped.startswith("/*"):
                    continue
                if "var(" in stripped or "color-mix(" in stripped:
                    continue
                if HARDCODED_THEME_COLOR_PATTERN.search(stripped):
                    relative_path = path.relative_to(Path(__file__).resolve().parents[1])
                    offenders.append(f"{relative_path}:{block_start + offset}: {stripped}")

    assert offenders == []


def test_dark_theme_does_not_override_fixed_action_gradients():
    offenders = []

    for line_number, line in enumerate(THEME_OVERRIDE_FILE.read_text(encoding="utf-8").splitlines(), start=1):
        stripped = line.strip()
        if any(token in stripped for token in FIXED_ACTION_TOKENS):
            offenders.append(f"{THEME_OVERRIDE_FILE.relative_to(Path(__file__).resolve().parents[1])}:{line_number}: {stripped}")

    assert offenders == []


def test_dark_theme_declares_action_text_state_tokens():
    content = THEME_OVERRIDE_FILE.read_text(encoding="utf-8")
    assert "--vc-color-on-action:" in content
    assert "--vc-color-on-action-hover:" in content


def test_navbar_theme_switch_replaces_settings_theme_buttons():
    content = INDEX_TEMPLATE.read_text(encoding="utf-8")
    assert "navbar-theme-switch" in content
    assert "data-theme-switch" in content
    assert "settings-theme-toggle" not in content


def test_theme_switch_cloud_lives_in_sprite():
    template_content = INDEX_TEMPLATE.read_text(encoding="utf-8")
    sprite_content = SPRITE_SVG.read_text(encoding="utf-8")
    assert "#theme-switch-cloud" in template_content
    assert 'id="theme-switch-cloud"' in sprite_content
    cloud_symbol = sprite_content.split('id="theme-switch-cloud"', 1)[1].split("</symbol>", 1)[0]
    assert 'fill="currentColor"' not in cloud_symbol


def test_theme_switch_cloud_uses_fixed_cloud_token():
    content = (STYLE_SOURCE_DIR / "system" / "30-components.css").read_text(encoding="utf-8")
    tokens = (STYLE_SOURCE_DIR / "system" / "00-tokens.css").read_text(encoding="utf-8")
    assert "fill: var(--vc-theme-switch-cloud, #e6e6e6)" in content
    assert "--vc-theme-switch-cloud: #e6e6e6" in tokens
    assert "--vc-theme-switch-day-bg: #4bd6ff" in tokens


def test_theme_switch_uses_button_radius():
    content = (STYLE_SOURCE_DIR / "system" / "30-components.css").read_text(encoding="utf-8")
    assert ".theme-switch {" in content
    assert "border-radius: var(--vc-radius-md, 8px)" in content
    assert ".theme-switch-slider {" in content


def test_theme_switch_has_interactive_states():
    content = (STYLE_SOURCE_DIR / "system" / "30-components.css").read_text(encoding="utf-8")
    assert ".theme-switch:hover .theme-switch-slider" in content
    assert ".theme-switch:active {" in content
    assert ".theme-switch:active .theme-switch-slider" in content
    assert "filter: brightness(1.08)" in content
    assert "transform: scale(0.96)" in content


def test_mobile_navbar_aligns_with_function_tools():
    content = (STYLE_SOURCE_DIR / "00-mobile-base.css").read_text(encoding="utf-8")
    template_content = INDEX_TEMPLATE.read_text(encoding="utf-8")
    for source in (content, template_content):
        assert ".navbar .container" in source
        assert "padding-left: 2rem" in source
        assert "padding-right: 2rem" in source
        assert "font-size: clamp(15px, 4.8vw, 17px)" in source
        assert "text-align: left" in source


def test_dark_theme_switch_night_bg_follows_page_bg():
    content = THEME_OVERRIDE_FILE.read_text(encoding="utf-8")
    assert "--vc-theme-switch-night-bg: var(--vc-color-bg)" in content


def test_theme_switch_js_syncs_checkbox_state():
    content = (FRONTEND_SOURCE_DIR / "00-theme.js").read_text(encoding="utf-8")
    assert "[data-theme-switch]" in content
    assert "input.checked = theme === 'light'" in content
    assert "input.checked ? 'light' : 'dark'" in content


def test_mobile_maintenance_panel_uses_compact_buttons():
    content = (STYLE_SOURCE_DIR / "60-settings.css").read_text(encoding="utf-8")
    assert ".maintenance-status > div" in content
    assert ".maintenance-create-btn.maintenance-panel-btn" in content
    assert "height: 2rem !important" in content
    assert "font-size: 0.82rem !important" in content
    assert "flex-direction: row" in content


def test_settings_table_hover_rules_cover_cells():
    content = (STYLE_SOURCE_DIR / "60-settings.css").read_text(encoding="utf-8")
    for tbody_id in ("#tagsList", "#ratingsList", "#dbBackupsList"):
        assert f"{tbody_id} tr:hover" in content
        assert f"{tbody_id} tr:hover > th" in content
        assert f"{tbody_id} tr:hover > td" in content
        assert f"{tbody_id} tr:active > td" in content


def test_thumbnail_source_buttons_use_gradient_action_tokens():
    content = (STYLE_SOURCE_DIR / "20-thumbnail.css").read_text(encoding="utf-8")
    assert '.thumbnail-source-tabs .button.is-small[aria-pressed="true"]' in content
    assert "--vc-action-primary" in content
    assert "--vc-color-on-action" in content
    assert "--vc-color-on-action-hover" in content


def test_mobile_settings_tabs_keep_readable_height():
    content = (STYLE_SOURCE_DIR / "60-settings.css").read_text(encoding="utf-8")
    assert "@media screen and (max-width: 768px)" in content
    assert "min-height: 3rem" in content
    assert "flex-wrap: nowrap" in content
    assert "min-width: max-content" in content
    assert "min-height: 2.9rem" in content
    assert "line-height: 1.2" in content


def test_thumbnail_capture_buttons_use_stronger_token_mix():
    content = (STYLE_SOURCE_DIR / "20-thumbnail.css").read_text(encoding="utf-8")
    assert "color-mix(in srgb, var(--thumbnail-action-color) 58%" in content
    assert "color-mix(in srgb, var(--thumbnail-action-color) 52%" in content
    assert "color-mix(in srgb, var(--thumbnail-action-color) 38%" in content
    assert "--vc-thumbnail-action-bg" in content
    assert "--vc-thumbnail-action-border" in content


def test_thumbnail_local_video_delete_uses_confirmed_icon_action():
    events = (Path(__file__).resolve().parents[1] / "src" / "config" / "events.js").read_text(encoding="utf-8")
    local_browser = (FRONTEND_SOURCE_DIR / "60-thumbnail" / "30-local-browser.js").read_text(encoding="utf-8")
    emby_browser = (FRONTEND_SOURCE_DIR / "60-thumbnail" / "20-emby-browser.js").read_text(encoding="utf-8")
    styles = (STYLE_SOURCE_DIR / "20-thumbnail.css").read_text(encoding="utf-8")

    assert "delete_video_file: 1024" in events
    assert "createThumbnailDeleteFileButton" in local_browser
    assert "delete-btn-top-icon" in local_browser
    assert "delete-btn-bottom-icon" in local_browser
    assert "confirmDeleteThumbnailVideoFile" in local_browser
    assert "event_map.delete_video_file" in local_browser
    assert "confirm: true" in local_browser
    assert "clearDeletedThumbnailVideo" in local_browser
    assert "await loadThumbnailDirectory(result.next_path ?? thumbnailState.currentPath)" in local_browser
    deleted_video_state = local_browser.split("function clearDeletedThumbnailVideo(videoFile) {", 1)[1].split("\n}\n", 1)[0]
    assert "clearThumbnailCaptures()" not in deleted_video_state
    assert "thumbnail-delete-file" not in emby_browser
    assert ".thumbnail-file-row.has-delete" in styles
    assert ".thumbnail-delete-file" in styles
    assert "var(--vc-color-danger)" in styles


def test_thumbnail_copy_name_removes_only_the_last_extension():
    local_browser = (FRONTEND_SOURCE_DIR / "60-thumbnail" / "30-local-browser.js").read_text(encoding="utf-8")

    assert "function getThumbnailVideoNameWithoutExtension" in local_browser
    assert "normalizedName.lastIndexOf('.')" in local_browser
    assert "normalizedName.slice(0, extensionIndex)" in local_browser
    assert "navigator.clipboard.writeText(copyName)" in local_browser
    assert "textarea.value = copyName" in local_browser
    assert "`已复制文件名：${copyName}`" in local_browser


def test_capture_timestamp_upload_and_emby_viewer_linking_are_wired():
    events = (Path(__file__).resolve().parents[1] / "src" / "config" / "events.js").read_text(encoding="utf-8")
    foundation = (FRONTEND_SOURCE_DIR / "00-foundation.js").read_text(encoding="utf-8")
    capture = (FRONTEND_SOURCE_DIR / "60-thumbnail" / "50-capture-batch.js").read_text(encoding="utf-8")
    add_movie = (FRONTEND_SOURCE_DIR / "70-images" / "20-viewer-navigation.js").read_text(encoding="utf-8")
    edit_movie = (FRONTEND_SOURCE_DIR / "50-movies" / "13-edit-update-submit.js").read_text(encoding="utf-8")
    emby = (FRONTEND_SOURCE_DIR / "20-tools" / "10-emby-search-player.js").read_text(encoding="utf-8")
    template = INDEX_TEMPLATE.read_text(encoding="utf-8")
    styles = (STYLE_SOURCE_DIR / "40-images-rating-cells.css").read_text(encoding="utf-8")

    assert "resolve_movie_emby_playback: 1025" in events
    assert "link_movie_emby: 1026" in events
    assert "appendCaptureTimestampToUpload" in foundation
    assert "file.captureTimestamp = currentTime" in capture
    assert "appendCaptureTimestampToUpload(imageFormData, file)" in add_movie
    assert "appendCaptureTimestampToUpload(formData, file)" in edit_movie
    assert "image-viewer-timecode" in template
    assert "parseImageCaptureTimestamp" in add_movie
    assert "playImageCaptureInEmby" in add_movie
    assert "openEmbyLinkSelection" in emby
    assert "handleEmbyPlaybackError" in emby
    assert "recoveryAttempted" in emby
    assert ".image-viewer-timecode" in styles


def test_capture_timecode_uses_hours_and_viewer_embeds_emby_video():
    navigation = (FRONTEND_SOURCE_DIR / "70-images" / "20-viewer-navigation.js").read_text(encoding="utf-8")
    layout = (FRONTEND_SOURCE_DIR / "70-images" / "10-viewer-layout.js").read_text(encoding="utf-8")
    emby = (FRONTEND_SOURCE_DIR / "20-tools" / "10-emby-search-player.js").read_text(encoding="utf-8")
    actions = (FRONTEND_SOURCE_DIR / "10-modal-and-delegates.js").read_text(encoding="utf-8")
    template = INDEX_TEMPLATE.read_text(encoding="utf-8")
    styles = (STYLE_SOURCE_DIR / "40-images-rating-cells.css").read_text(encoding="utf-8")

    assert "Math.floor(totalSeconds / 3600)" in navigation
    assert "Math.floor((totalSeconds % 3600) / 60)" in navigation
    assert ".map(value => String(value).padStart(2, '0'))" in navigation
    assert ".join(':')" in navigation
    assert "image-viewer-emby-video" in template
    assert "exit-image-viewer-video" in template
    assert "'exit-image-viewer-video': exitImageViewerVideoMode" in actions
    assert "openImageViewerEmbyPlayer" in navigation
    assert "seekImageViewerEmbyPlayback(captureTimestamp)" in navigation
    assert "stopImageViewerEmbyPlayback()" in navigation
    assert "currentImageMovieTitle = ''" in navigation
    assert "target === 'viewer'" in emby
    assert "playbackTarget: context.target" in emby
    assert "playbackTarget: 'viewer'" in navigation
    assert "const isVideoMode" in layout
    assert "displayWidth * 9 / 16" in layout
    assert ".image-viewer-container.is-video-mode" in styles
    assert ".image-viewer-emby-video" in styles
    assert ".image-viewer-video-return" in styles

    timecode_block = styles.split("#imageViewerModal .image-viewer-timecode {", 1)[1].split("}", 1)[0]
    return_block = styles.split("#imageViewerModal .image-viewer-video-return {", 1)[1].split("}", 1)[0]
    assert "top: 0.7rem" in timecode_block
    assert "left: 0.7rem" in timecode_block
    assert "bottom: auto" in timecode_block
    assert "opacity: 0.65" in timecode_block
    assert "opacity 160ms ease" in timecode_block
    assert "top: 0.7rem" in return_block
    assert "left: 0.7rem" in return_block
    assert "opacity: 0.65" in return_block
    assert "opacity 160ms ease" in return_block
    assert "#imageViewerModal .image-viewer-timecode:focus-visible" in styles
    assert "#imageViewerModal .image-viewer-video-return:focus-visible" in styles
    assert "opacity: 1" in styles
    assert "opacity: 0.45" in styles


def test_bound_movie_cards_offer_emby_playback_before_edit():
    movie_handlers = (Path(__file__).resolve().parents[1] / "video_collection" / "api_handlers_movies.py").read_text(encoding="utf-8")
    movie_results = (FRONTEND_SOURCE_DIR / "50-movies" / "20-results-table.js").read_text(encoding="utf-8")
    actions = (FRONTEND_SOURCE_DIR / "10-modal-and-delegates.js").read_text(encoding="utf-8")
    emby = (FRONTEND_SOURCE_DIR / "20-tools" / "10-emby-search-player.js").read_text(encoding="utf-8")
    styles = (STYLE_SOURCE_DIR / "50-modals-results.css").read_text(encoding="utf-8")

    assert "m.added_date, m.emby_item_id" in movie_handlers
    assert "if (movie.emby_item_id)" in movie_results
    assert "createMovieCardEmbyButton(movieIndex)" in movie_results
    assert "actions.push(createMovieCardEditButton(movieIndex))" in movie_results
    assert movie_results.index("actions.push(createMovieCardEmbyButton(movieIndex))") < movie_results.index("actions.push(createMovieCardEditButton(movieIndex))")
    assert "dataset: { action: 'play-movie-emby', movieIndex }" in movie_results
    assert "createSpriteSvg('emby-icon'" in movie_results
    assert "actionElement.dataset.action === 'play-movie-emby'" in actions
    assert "playMovieEmbyFromSearch(allMovies[index])" in actions
    assert "function playMovieEmbyFromSearch(movie)" in emby
    assert "openEmbyPlayer(data.playback.streamUrl" in emby
    assert "rememberMovieEmbyLink" in emby
    assert ".movie-card-actions" in styles
    assert ".movie-card-emby-btn" in styles
    shared_icon_block = styles.split(".movie-card-edit-btn svg,", 1)[1].split("}", 1)[0]
    emby_icon_block = styles.rsplit(".movie-card-emby-btn svg {", 1)[1].split("}", 1)[0]
    assert "width: 0.95rem" in shared_icon_block
    assert "height: 0.95rem" in shared_icon_block
    emby_icon_width = re.search(r"width:\s*([\d.]+)rem", emby_icon_block)
    emby_icon_height = re.search(r"height:\s*([\d.]+)rem", emby_icon_block)
    assert emby_icon_width and float(emby_icon_width.group(1)) > 0.95
    assert emby_icon_height and float(emby_icon_height.group(1)) > 0.95


def test_edit_modal_can_bind_emby_without_starting_playback():
    template = INDEX_TEMPLATE.read_text(encoding="utf-8")
    edit_modal = (FRONTEND_SOURCE_DIR / "50-movies" / "10-edit-open-modal.js").read_text(encoding="utf-8")
    actions = (FRONTEND_SOURCE_DIR / "10-modal-and-delegates.js").read_text(encoding="utf-8")
    emby = (FRONTEND_SOURCE_DIR / "20-tools" / "10-emby-search-player.js").read_text(encoding="utf-8")
    movie_results = (FRONTEND_SOURCE_DIR / "50-movies" / "20-results-table.js").read_text(encoding="utf-8")
    styles = (STYLE_SOURCE_DIR / "50-modals-results.css").read_text(encoding="utf-8")

    edit_start = template.index('id="editModal"')
    edit_end = template.index('id="wtlModal"', edit_start)
    edit_template = template[edit_start:edit_end]
    assert 'id="edit-emby-link-field"' in edit_template
    assert 'id="edit-emby-link-status"' in edit_template
    assert 'id="edit-emby-link-feedback"' in edit_template
    assert 'data-action="edit-movie-emby"' in edit_template
    assert '<span class="edit-emby-link-action-text">绑定</span>' in edit_template
    edit_emby_button = edit_template.split('data-action="edit-movie-emby"', 1)[1].split('</button>', 1)[0]
    assert '<svg' not in edit_emby_button
    assert edit_template.index('id="edit-emby-link-field"') < edit_template.index('class="field recommend-field"')

    assert "function syncEditMovieEmbyState" in edit_modal
    assert "dateField.before(embyLinkField)" in edit_modal
    assert "syncEditMovieEmbyState(movie.title, movie.emby_item_id)" in edit_modal
    assert "buttonText.textContent = isLinked ? '播放' : '绑定'" in edit_modal
    assert "button.setAttribute('aria-label', isLinked ? '播放 Emby' : '绑定 Emby')" in edit_modal
    assert "'edit-movie-emby': handleEditMovieEmbyAction" in actions

    assert "function handleEditMovieEmbyAction" in emby
    edit_action_body = emby.split("async function handleEditMovieEmbyAction() {", 1)[1].split("\n}\n\nasync function playMovieEmbyFromSearch", 1)[0]
    assert "playMovieEmbyFromSearch({ title, emby_item_id: itemId })" in edit_action_body
    assert "event_map.resolve_movie_emby_playback" in edit_action_body
    assert "linkMode: 'save-only'" in edit_action_body
    assert "setEditMovieEmbyFeedback('绑定成功', 'success')" in edit_action_body
    assert "openEmbyPlayer" not in edit_action_body
    assert "startEmbyPlayback" not in edit_action_body

    link_body = emby.split("async function linkMovieEmby(movie) {", 1)[1].split("\n}\n\nasync function handleEditMovieEmbyAction", 1)[0]
    assert "const saveOnly = context.linkMode === 'save-only'" in link_body
    assert link_body.index("if (saveOnly) {") < link_body.index("startEmbyPlayback(")
    save_only_body = link_body.split("if (saveOnly) {", 1)[1].split("}", 1)[0]
    assert "setEditMovieEmbyFeedback('绑定成功', 'success')" in save_only_body
    assert "return;" in save_only_body

    assert "if (movie.emby_item_id)" in movie_results
    assert "syncEditMovieEmbyState(movieTitle, normalizedItemId" in emby
    assert "#editModal .edit-emby-link-panel" in styles
    assert "#editModal .edit-emby-link-action" in styles
    assert "#editModal .edit-emby-link-action svg" not in styles
    assert "var(--vc-service-card-bg" in styles


def test_edit_movie_save_tracks_actual_content_changes():
    root = Path(__file__).resolve().parents[1]
    template = INDEX_TEMPLATE.read_text(encoding="utf-8")
    build_script = (root / "scripts" / "build-js.js").read_text(encoding="utf-8")
    ratings = (FRONTEND_SOURCE_DIR / "50-movies" / "00-ratings-and-drag.js").read_text(encoding="utf-8")
    open_modal = (FRONTEND_SOURCE_DIR / "50-movies" / "10-edit-open-modal.js").read_text(encoding="utf-8")
    update_submit = (FRONTEND_SOURCE_DIR / "50-movies" / "13-edit-update-submit.js").read_text(encoding="utf-8")
    dirty_state = (FRONTEND_SOURCE_DIR / "50-movies" / "14-edit-dirty-state.js").read_text(encoding="utf-8")
    button_effects = (STYLE_SOURCE_DIR / "30-controls-ratings.css").read_text(encoding="utf-8")

    save_button = re.search(
        r'<button[^>]+data-action="update-movie"[^>]*>',
        template,
    )
    assert save_button
    assert "disabled" in save_button.group(0)
    assert 'aria-disabled="true"' in save_button.group(0)
    assert "src/main/50-movies/14-edit-dirty-state.js" in build_script

    for state_key in (
        "recommended",
        "review",
        "tags",
        "ratings",
        "existingImages",
        "uploadedFiles",
    ):
        assert state_key in dirty_state

    current_state_block = dirty_state[
        dirty_state.index("function getCurrentEditMovieState"):
        dirty_state.index("function getInitialEditMovieState")
    ]
    assert "emby" not in current_state_block.lower()
    assert "MutationObserver" in dirty_state
    assert "form.addEventListener('input', scheduleEditMovieDirtyCheck)" in dirty_state
    assert "form.addEventListener('change', scheduleEditMovieDirtyCheck)" in dirty_state
    assert "serializeEditMovieState(getCurrentEditMovieState()) !== editMovieBaselineSnapshot" in dirty_state
    assert "session !== editMovieDirtySession" in dirty_state
    assert "Promise.allSettled([tagsReady, ratingsReady])" in open_modal
    assert "completeEditMovieDirtyTracking(dirtyTrackingSession, movie)" in open_modal
    assert "if (!isEditMovieDirty()) return;" in update_submit
    assert "setEditMovieSavePending(false)" in update_submit
    assert "new Event('change', { bubbles: true })" in ratings
    assert ".save-btn:not(:disabled):not([disabled]):hover" in template
    assert ".save-btn:not(:disabled):not([disabled]):hover" in button_effects
    assert "#editModal .save-btn:disabled" in template
    assert "#editModal .save-btn:disabled" in button_effects
    disabled_effects = button_effects[button_effects.index("#editModal .save-btn:disabled"):]
    assert "animation: none !important" in disabled_effects
    assert "transform: none !important" in disabled_effects
    assert "box-shadow: none !important" in disabled_effects


def test_wtl_screenshot_import_uses_safe_api_event():
    content = (FRONTEND_SOURCE_DIR / "20-tools" / "30-wtl-search-results.js").read_text(encoding="utf-8")
    assert "event_map.fetch_external_image" in content
    assert "wtlDataUrlToFile" in content
    assert "addSelectedWtlScreenshotsToUploadArea" in content
    assert "startWtlScreenshotDrag" in content
    assert "currentDraggedThumbnailFilesPromise" in content
    assert "draggable: 'true'" in content
    assert "addimage-upload-areaFiles" not in content


def test_upload_area_accepts_async_dragged_files():
    content = (FRONTEND_SOURCE_DIR / "70-images" / "00-upload.js").read_text(encoding="utf-8")
    assert "currentDraggedThumbnailFilesPromise" in content
    assert "await window.currentDraggedThumbnailFilesPromise" in content


def test_wtl_screenshot_actions_share_thumbnail_button_tokens():
    content = (STYLE_SOURCE_DIR / "10-services-tools.css").read_text(encoding="utf-8")
    assert "#wtlModal .wtl-screenshot-action" in content
    assert "--thumbnail-action-color" in content
    assert "--vc-thumbnail-action-bg" in content
    assert "white-space: normal" in content
    assert "overflow-wrap: anywhere" in content
    assert "#wtlModal .wtl-screenshot-action::before" in content


def test_wtl_status_indicator_uses_safe_status_api():
    template = INDEX_TEMPLATE.read_text(encoding="utf-8")
    actions = (FRONTEND_SOURCE_DIR / "10-modal-and-delegates.js").read_text(encoding="utf-8")
    service_modals = (FRONTEND_SOURCE_DIR / "20-tools" / "20-service-modals.js").read_text(encoding="utf-8")
    content = (FRONTEND_SOURCE_DIR / "20-tools" / "30-wtl-search-results.js").read_text(encoding="utf-8")
    styles = (STYLE_SOURCE_DIR / "10-services-tools.css").read_text(encoding="utf-8")
    wtl_start = template.index('<div class="modal" id="wtlModal">')
    wtl_header_start = template.index('<header class="modal-card-head">', wtl_start)
    wtl_header_end = template.index('</header>', wtl_header_start)
    wtl_sticky_start = template.index('<div class="sticky-search"', wtl_header_end)
    wtl_results_start = template.index('id="wtl-results"', wtl_sticky_start)
    status_index = template.index('id="wtl-status-panel"', wtl_start)
    status_meta_body = re.search(
        r"function formatWtlStatusMeta\(\) \{(?P<body>.*?)\n\}",
        content,
        re.DOTALL,
    ).group("body")

    assert "wtl-status-panel" in template
    assert 'data-action="refresh-wtl-status"' in template
    assert wtl_header_start < status_index < wtl_header_end
    assert status_index < wtl_sticky_start
    assert "wtl-status-panel" not in template[wtl_sticky_start:wtl_results_start]
    assert "wtl-status-refresh" not in template
    assert "event_map.check_wtl_status" in content
    assert "function checkWtlStatus" in content
    assert "function refreshWtlStatus" in content
    assert "function setWtlSearchDisabled" in content
    assert "serviceCached" not in status_meta_body
    assert "serviceCheckedAt" not in status_meta_body
    assert "panel.disabled = wtlState.serviceStatus === 'checking'" in content
    assert "panel.setAttribute('aria-disabled'" in content
    assert "serviceStatus === 'checking'" in content
    assert "serviceStatus === 'offline'" in content
    assert "'refresh-wtl-status': refreshWtlStatus" in actions
    assert "checkWtlStatus()" in service_modals
    assert "#wtlModal .modal-card-head" in styles
    assert "#wtlModal .modal-card-controls" in styles
    assert "#wtlModal .wtl-status-panel" in styles
    assert "#wtlModal .wtl-status-panel[data-state=\"online\"]" in styles
    assert "#wtlModal .wtl-status-panel[data-state=\"offline\"]" in styles
    assert "#wtlModal .wtl-status-refresh" not in styles
    assert "#wtlModal .wtl-status-panel {\n" in styles
    status_panel_block = styles.split("#wtlModal .wtl-status-panel {", 1)[1].split("}", 1)[0]
    assert "margin-left: auto" not in status_panel_block
    assert "#wtlModal .wtl-status-meta {\n        display: none;" not in styles


def test_image_viewer_has_thumbnail_navigation():
    template = INDEX_TEMPLATE.read_text(encoding="utf-8")
    layout = (FRONTEND_SOURCE_DIR / "70-images" / "10-viewer-layout.js").read_text(encoding="utf-8")
    navigation = (FRONTEND_SOURCE_DIR / "70-images" / "20-viewer-navigation.js").read_text(encoding="utf-8")
    styles = (STYLE_SOURCE_DIR / "40-images-rating-cells.css").read_text(encoding="utf-8")

    assert "image-viewer-strip" in template
    assert "renderImageViewerStrip" in navigation
    assert "setImageViewerIndex" in navigation
    assert "scrollIntoView" in navigation
    assert "aria-current" in navigation
    assert "stripHeight" in layout
    assert "imagePaneHeight" in layout
    assert "#imageViewerModal .image-viewer-strip" in styles
    assert "#imageViewerModal .image-viewer-thumb" in styles


def test_wtl_result_sections_are_visually_separated():
    content = (FRONTEND_SOURCE_DIR / "20-tools" / "30-wtl-search-results.js").read_text(encoding="utf-8")
    styles = (STYLE_SOURCE_DIR / "10-services-tools.css").read_text(encoding="utf-8")

    assert "content wtl-result-info" in content
    assert "wtl-screenshots-title" in content
    assert "#wtlModal .wtl-result-info" in styles
    assert "#wtlModal .wtl-screenshots-panel" in styles
    assert "#wtlModal .wtl-screenshots-title" in styles
    assert "color-mix(in srgb, var(--vc-tool-wtl" in styles


def test_search_result_counts_use_safe_dom_and_tokens():
    foundation = (FRONTEND_SOURCE_DIR / "00-foundation.js").read_text(encoding="utf-8")
    search_actions = (FRONTEND_SOURCE_DIR / "40-search" / "20-search-actions.js").read_text(encoding="utf-8")
    movie_results = (FRONTEND_SOURCE_DIR / "50-movies" / "20-results-table.js").read_text(encoding="utf-8")
    emby_results = (FRONTEND_SOURCE_DIR / "20-tools" / "10-emby-search-player.js").read_text(encoding="utf-8")
    styles = (STYLE_SOURCE_DIR / "system" / "30-components.css").read_text(encoding="utf-8")

    assert "function createResultsCountSummary" in foundation
    assert "text: `共 ${safeCount} ${unitText}`" in foundation
    assert "pagination.total" in search_actions
    assert "searchResultTotal" in search_actions
    assert "searchResultTotal = 0" in search_actions
    assert "createResultsCountSummary(searchResultTotal, '部电影', 'movie-results-count')" in movie_results
    assert "const resultUnit = embyLinkSelectionContext ? '个候选' : '个结果'" in emby_results
    assert "createResultsCountSummary(candidates.length, '个候选', 'emby-results-count')" in emby_results
    assert ".results-count-summary" in styles
    assert ".movie-results-count" in styles
    assert ".emby-results-count" in styles
    assert "var(--vc-result-section-bg)" in styles
    assert "var(--vc-result-muted)" in styles


def test_local_image_variants_use_shared_deferred_loading():
    foundation = (FRONTEND_SOURCE_DIR / "00-foundation.js").read_text(encoding="utf-8")
    movie_results = (FRONTEND_SOURCE_DIR / "50-movies" / "20-results-table.js").read_text(encoding="utf-8")
    edit_modal = (FRONTEND_SOURCE_DIR / "50-movies" / "10-edit-open-modal.js").read_text(encoding="utf-8")
    viewer_navigation = (FRONTEND_SOURCE_DIR / "70-images" / "20-viewer-navigation.js").read_text(encoding="utf-8")
    emby_results = (FRONTEND_SOURCE_DIR / "20-tools" / "10-emby-search-player.js").read_text(encoding="utf-8")

    assert "function buildImageUrl(filename, variant = '')" in foundation
    assert "?variant=${encodeURIComponent(variant)}" in foundation
    assert "function prepareDeferredImage" in foundation
    assert "rootMargin: '240px 0px'" in foundation
    assert "buildImageUrl(firstImageFilename, 'cover')" in movie_results
    assert "eager: movieIndex < 3" in movie_results
    assert "fetchPriority: movieIndex < 3 ? 'high' : 'auto'" in movie_results
    assert "buildImageUrl(trimmedFilename, 'cover')" in edit_modal
    assert "buildImageUrl(filename, 'cover')" in viewer_navigation
    assert "prepareDeferredImage" in emby_results


def test_movie_results_render_as_cards():
    content = (FRONTEND_SOURCE_DIR / "50-movies" / "20-results-table.js").read_text(encoding="utf-8")
    foundation = (FRONTEND_SOURCE_DIR / "00-foundation.js").read_text(encoding="utf-8")
    search_actions = (FRONTEND_SOURCE_DIR / "40-search" / "20-search-actions.js").read_text(encoding="utf-8")
    styles = (STYLE_SOURCE_DIR / "50-modals-results.css").read_text(encoding="utf-8")

    assert "const itemsPerPage = 9" in foundation
    assert "per_page: itemsPerPage" in search_actions
    assert "function renderSearchLoadingSkeleton(rowCount = itemsPerPage)" in content
    assert "movie-results-grid" in content
    assert "movie-result-card" in content
    assert "movie-results-table" not in content
    assert "createMovieCard(" in content
    assert "createSearchSkeletonCard" in content
    assert "createMovieCardTextBlock" in content
    assert "movie-card-section-label" not in content
    assert ".movie-results-grid" in styles
    assert "@media screen and (min-width: 1024px)" in styles
    assert "grid-template-columns: repeat(3, minmax(0, 1fr))" in styles
    assert "@media screen and (min-width: 1600px)" not in styles
    assert "grid-template-columns: repeat(4, minmax(0, 1fr))" not in styles
    assert "@media screen and (max-width: 768px)" in styles
    assert "grid-template-columns: 1fr" in styles
    assert ".movie-result-card" in styles
    assert "display: flex" in styles
    assert "flex-direction: column" in styles
    assert "aspect-ratio: 16 / 9" in styles
    assert "movie-results-table" not in styles
    assert "movie-card-section-label" not in styles


def test_movie_result_cards_show_recommend_badge_and_icon_edit_button():
    content = (FRONTEND_SOURCE_DIR / "50-movies" / "20-results-table.js").read_text(encoding="utf-8")
    styles = (STYLE_SOURCE_DIR / "50-modals-results.css").read_text(encoding="utf-8")
    sprite = SPRITE_SVG.read_text(encoding="utf-8")

    assert "movie-card-recommend-badge" in content
    assert "recommend-light-icon" in content
    assert "movie-card-edit-btn" in content
    assert "edit-btn-icon" in content
    assert "aria-label': '编辑电影'" in content
    assert "dataset: { action: 'edit-movie', movieIndex }" in content
    assert "className: 'movie-card-edit-btn'" in content
    assert "movie-card-edit-btn edit-btn" not in content
    assert ".movie-result-card.is-recommended" in styles
    assert ".movie-result-card.is-recommended:hover" in styles
    assert ".movie-result-card.is-recommended::before" in styles
    assert ".movie-result-card.is-recommended::after" in styles
    assert ".movie-result-card.is-recommended:hover::after" in styles
    assert "animation: movie-recommended-glow" in styles
    assert "animation: movie-recommended-surface" in styles
    assert "animation: movie-recommended-sheen" in styles
    assert "@keyframes movie-recommended-surface" in styles
    assert "@keyframes movie-recommended-sheen" in styles
    assert "border-width: 2px" in styles
    assert "transition: border-color 0.22s ease, box-shadow 0.32s ease" in styles
    assert ".movie-card-recommend-badge" in styles
    assert "z-index: 4" in styles
    assert "width: 3.3rem" in styles
    assert "height: 3.3rem" in styles
    assert ".movie-card-edit-btn" in styles
    assert "background: transparent !important" in styles
    assert "background: var(--vc-result-edit-hover-bg" in styles
    assert "background: var(--vc-result-edit-active-bg" in styles
    assert "border: 0 !important" in styles
    assert "--vc-result-edit-shadow" in styles
    assert "--vc-result-edit-hover-bg" in styles
    assert "--vc-result-edit-active-bg" in styles
    assert "--vc-result-edit-icon-shadow" in styles
    assert "--vc-result-edit-icon" in styles
    assert "--vc-result-recommended-gold" in styles
    assert "--vc-result-recommended-glow" in styles
    assert "--vc-result-recommended-sheen" in styles
    assert "--vc-result-recommended-surface-glow" in styles
    assert "--vc-result-recommended-icon" in styles
    assert "--vc-result-recommended-icon-shadow" in styles
    assert '<symbol id="edit-btn-icon"' in sprite

    tokens = (STYLE_SOURCE_DIR / "system" / "00-tokens.css").read_text(encoding="utf-8")
    dark_theme = THEME_OVERRIDE_FILE.read_text(encoding="utf-8")
    assert "--vc-result-recommended-gold: #fbbf24" in tokens
    assert "--vc-result-recommended-bg: rgba(251, 191, 36, 0.34)" in tokens
    assert "--vc-result-recommended-glow: rgba(251, 191, 36, 0.78)" in tokens
    assert "--vc-result-recommended-sheen: rgba(255, 255, 255, 0.72)" in tokens
    assert "--vc-result-recommended-surface-glow: rgba(251, 191, 36, 0.46)" in tokens
    assert "--vc-result-recommended-icon: #ffffff" in tokens
    assert "--vc-result-edit-icon: #ffffff" in tokens
    assert "--vc-result-edit-hover-bg: rgba(15, 23, 42, 0.32)" in tokens
    assert "--vc-result-edit-active-bg: rgba(15, 23, 42, 0.48)" in tokens
    assert "--vc-result-recommended-gold:" not in dark_theme
    assert "--vc-result-recommended-bg:" not in dark_theme
    assert "--vc-result-recommended-sheen:" not in dark_theme
    assert "--vc-result-recommended-surface-glow:" not in dark_theme
    assert "--vc-result-recommended-text:" not in dark_theme

    recommended_block = styles.split(".movie-result-card.is-recommended {", 1)[1].split("}", 1)[0]
    recommended_surface_block = styles.split(".movie-result-card.is-recommended::before {", 1)[1].split("}", 1)[0]
    assert "linear-gradient" not in recommended_block
    assert "radial-gradient" not in recommended_block
    assert "background: var(--vc-result-card-bg" in recommended_block
    assert "background: var(--vc-result-recommended-surface-glow" in recommended_surface_block
    assert "linear-gradient" not in recommended_surface_block
    assert "radial-gradient" not in recommended_surface_block


def test_movie_result_cards_wrap_text_and_use_tokens():
    movie_results = (FRONTEND_SOURCE_DIR / "50-movies" / "20-results-table.js").read_text(encoding="utf-8")
    result_styles = (STYLE_SOURCE_DIR / "50-modals-results.css").read_text(encoding="utf-8")
    rating_styles = (STYLE_SOURCE_DIR / "40-images-rating-cells.css").read_text(encoding="utf-8")

    assert "text: `${dimension.name}:`" not in movie_results
    assert "createRatingNameElement(dimension.name" in movie_results
    assert "movie-card-ratings-list vc-rating-list" in movie_results
    assert "rating-item vc-rating-item" in movie_results
    assert "stars vc-rating-stars" in movie_results
    assert ".movie-card-title" in result_styles
    assert ".movie-card-section-text" in result_styles
    assert ".movie-card-tag" in result_styles
    assert ".movie-card-ratings-list" in result_styles
    assert "overflow-wrap: anywhere" in result_styles
    assert "word-break: break-word" in result_styles
    assert "var(--vc-result-card-bg" in result_styles
    assert "var(--vc-result-card-border" in result_styles
    assert "var(--vc-result-section-border" in result_styles
    assert "grid-template-columns: repeat(2, minmax(0, 1fr))" in rating_styles
    assert "grid-template-columns: minmax(2.2em, max-content) max-content" in rating_styles
    assert "min-width: 2.2em" in rating_styles
    assert "gap: 0.22rem" in rating_styles
    assert "gap: 0.16rem" in rating_styles
    assert "font-size: 1rem" in rating_styles
    assert "gap: 0 5px !important" in rating_styles
    assert "width: 15px" in rating_styles
    assert "height: 15px" in rating_styles
    assert "text-overflow: ellipsis" in rating_styles
    assert "white-space: nowrap" in rating_styles
    assert "flex-shrink: 0" in rating_styles
    assert "--vc-rating-name-scroll-distance" in rating_styles
    assert "@keyframes vc-rating-name-scroll" in rating_styles


def test_shared_rating_layout_is_used_in_add_edit_and_results():
    add_ratings = (FRONTEND_SOURCE_DIR / "50-movies" / "00-ratings-and-drag.js").read_text(encoding="utf-8")
    edit_ratings = (FRONTEND_SOURCE_DIR / "50-movies" / "11-edit-tags-ratings.js").read_text(encoding="utf-8")
    movie_results = (FRONTEND_SOURCE_DIR / "50-movies" / "20-results-table.js").read_text(encoding="utf-8")
    rating_styles = (STYLE_SOURCE_DIR / "40-images-rating-cells.css").read_text(encoding="utf-8")
    template = INDEX_TEMPLATE.read_text(encoding="utf-8")

    for source in (add_ratings, edit_ratings, movie_results, rating_styles, template):
        assert "vc-rating-list" in source
    for source in (add_ratings, rating_styles, template):
        assert "vc-rating-item" in source
        assert "vc-rating-name" in source
        assert "vc-rating-name-text" in source
        assert "vc-rating-stars" in source
    assert "createRatingNameElement(dimension.name" in movie_results
    assert "vc-rating-item" in movie_results
    assert "vc-rating-stars" in movie_results

    assert "attrs: {\n            tabindex: '0',\n            title: safeName" in add_ratings
    assert "data-overflowing" in add_ratings
    assert "--vc-rating-name-scroll-distance" in add_ratings
    assert "scheduleRatingNameScrollSync(addRatingsContainer)" in add_ratings
    assert "scheduleRatingNameScrollSync(ratingsContainer)" in edit_ratings
    assert "scheduleRatingNameScrollSync(grid)" in movie_results
    assert "text: `${dimension.name}:`" not in movie_results
    assert not re.search(r"(?m)^\.dimension-name\s*\{[\s\S]*?min-width:\s*5rem", rating_styles)


def test_shared_table_cells_wrap_text_by_default():
    bridge = (STYLE_SOURCE_DIR / "system" / "20-bulma-bridge.css").read_text(encoding="utf-8")
    results_styles = (STYLE_SOURCE_DIR / "50-modals-results.css").read_text(encoding="utf-8")
    settings_styles = (STYLE_SOURCE_DIR / "60-settings.css").read_text(encoding="utf-8")

    assert ".table th,\n.table td" in bridge
    assert "overflow-wrap: anywhere" in bridge
    assert "white-space: normal" in bridge
    assert "word-break: break-word" in bridge

    assert ".table td {" in results_styles
    assert "text-overflow: clip" in results_styles
    assert "white-space: normal" in results_styles
    assert ".table td.ellipsis" in results_styles
    assert "white-space: nowrap" in results_styles
    assert ".table td.settings-actions-column" in results_styles

    assert ".maintenance-backups-table td:nth-child(2)" in settings_styles
    assert "overflow-wrap: anywhere" in settings_styles


def test_table_hover_tooltip_requires_title_attribute():
    styles = (STYLE_SOURCE_DIR / "50-modals-results.css").read_text(encoding="utf-8")

    assert ".table td.hoverable[title]:hover::after" in styles
    assert ".table td.hoverable:hover::after" not in styles
