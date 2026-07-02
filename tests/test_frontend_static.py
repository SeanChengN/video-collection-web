import re
from pathlib import Path


FRONTEND_SOURCE_DIR = Path(__file__).resolve().parents[1] / "src" / "main"
FORBIDDEN_DOM_HTML_PATTERN = re.compile(
    r"\.(?:innerHTML|outerHTML)\b|\.insertAdjacentHTML\b"
)


def test_frontend_source_avoids_html_string_injection():
    offenders = []
    for path in sorted(FRONTEND_SOURCE_DIR.rglob("*.js")):
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if FORBIDDEN_DOM_HTML_PATTERN.search(line):
                offenders.append(f"{path.relative_to(FRONTEND_SOURCE_DIR.parents[1])}:{line_number}: {line.strip()}")

    assert offenders == []
