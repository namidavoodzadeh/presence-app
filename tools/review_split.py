"""Split a unified diff into parts under a size limit, for tools/review-other-family.py.
Parts are exact slices of the diff: joined in order they give back the original, character for character, so
nothing is dropped and every line is reviewed. Splits fall on file boundaries ("diff --git" lines); a single file
over the limit is split at hunk boundaries ("@@" lines); a single hunk over the limit is split at line boundaries,
and a single line over the limit is cut into pieces of the limit (the last resort, so the diff is still reviewed
whole)."""
import re


def _cut(text, pattern):
    """Slices of text, each starting at a line that matches pattern (the first slice may start anywhere)."""
    starts = [m.start() for m in re.finditer(pattern, text, flags=re.M)]
    if not starts or starts[0] != 0:
        starts = [0] + starts
    return [text[a:b] for a, b in zip(starts, starts[1:] + [len(text)]) if b > a]


def _pieces(text, limit):
    """Pieces of text, each no longer than limit, at the coarsest boundary that fits."""
    if len(text) <= limit:
        return [text]
    for pattern in (r"^diff --git ", r"^@@ "):
        chunks = _cut(text, pattern)
        if len(chunks) > 1:
            return [p for c in chunks for p in _pieces(c, limit)]
    lines = text.splitlines(keepends=True)
    if len(lines) > 1:
        return [p for line in lines for p in _pieces(line, limit)]
    return [text[i:i + limit] for i in range(0, len(text), limit)]


def split_diff(diff, limit):
    """Parts of diff, each at most limit characters, packed greedily in order. "".join(parts) == diff."""
    if limit <= 0:
        raise ValueError("limit must be positive")
    parts, current = [], ""
    for piece in _pieces(diff, limit):
        if current and len(current) + len(piece) > limit:
            parts.append(current)
            current = ""
        current += piece
    if current or not parts:
        parts.append(current)
    return parts


def changed_files(diff):
    """The files a diff changes, in order, as named on its "diff --git a/X b/Y" lines."""
    return [m.group(1) for m in re.finditer(r"^diff --git a/.* b/(.*)$", diff, flags=re.M)]


def continued_file(parts, n):
    """The file that part n (0-based) continues from an earlier part, or None when it starts at a file boundary."""
    if n == 0 or parts[n].startswith("diff --git "):
        return None
    before = changed_files("".join(parts[:n]))
    return before[-1] if before else None
