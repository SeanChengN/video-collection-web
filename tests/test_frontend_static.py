import re
from pathlib import Path


FRONTEND_SOURCE_DIR = Path(__file__).resolve().parents[1] / "src" / "main"
INDEX_TEMPLATE = Path(__file__).resolve().parents[1] / "templates" / "index.html"
STYLE_SOURCE_DIR = Path(__file__).resolve().parents[1] / "src" / "styles"
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
    ".settings-theme-toggle .button",
    ".runtime-badge",
    ".movie-card",
    ".emby-playable-card",
    ".dupStart-btn",
    ".tags-filter .tag",
    ".tags-box .tag",
    "#add-tags .tag",
    "#edit-tags .tag",
    "#search-results .movie-results-table",
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
    ".thumbnail-item-time",
    ".image-box-title",
    ".ratings-box-title",
    ".tags-box-title",
    ".rating-item",
    ".dimension-name",
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
