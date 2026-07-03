import re
from pathlib import Path


FRONTEND_SOURCE_DIR = Path(__file__).resolve().parents[1] / "src" / "main"
INDEX_TEMPLATE = Path(__file__).resolve().parents[1] / "templates" / "index.html"
STYLE_SOURCE_DIR = Path(__file__).resolve().parents[1] / "src" / "styles"
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
    ".runtime-badge",
    ".movie-card",
    ".emby-playable-card",
    ".dupStart-btn",
    ".settings-list-item",
    ".thumbnail-file-row",
    ".image-box-title",
    ".ratings-box-title",
    ".tags-box-title",
    ".rating-item",
    ".dimension-name",
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
