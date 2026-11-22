"""Patches applied to a decoded (apktool) YouTube for Android TV.

Each patch finds its target by stable traits (strings, method signatures,
unobfuscated class names), never by obfuscated names like `dlk`, so the same
patch keeps working on newer YouTube versions.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path


class PatchError(Exception):
    pass


@dataclass
class Ctx:
    root: Path  # decoded apk dir
    cfg: dict
    notes: list[str] = field(default_factory=list)
    _smali: list[Path] | None = None

    def note(self, msg: str) -> None:
        self.notes.append(msg)
        print("  -", msg)

    # ---- smali lookup -------------------------------------------------
    def smali_files(self) -> list[Path]:
        if self._smali is None:
            self._smali = sorted(self.root.glob("smali*/**/*.smali"))
        return self._smali

    def class_file(self, descriptor: str) -> Path:
        """Lcom/foo/Bar; -> path of its smali file."""
        rel = descriptor[1:-1] + ".smali"
        for d in sorted(self.root.glob("smali*")):
            p = d / rel
            if p.exists():
                return p
        raise PatchError(f"class not found: {descriptor}")

    def files_with(self, needle: str) -> list[Path]:
        out = []
        for p in self.smali_files():
            if needle in p.read_text(encoding="utf-8"):
                out.append(p)
        return out

    def manifest(self) -> Path:
        return self.root / "AndroidManifest.xml"


METHOD_RE = re.compile(r"^\.method [^\n]*$", re.M)


def find_method(text: str, signature: str) -> tuple[int, int]:
    """Return (start, end) of the method whose header ends with `signature`,
    e.g. "f(Landroid/content/Context;I)I". `signature` may also be a regex
    when passed as re.Pattern."""
    hits = []
    for m in METHOD_RE.finditer(text):
        header = m.group(0)
        ok = signature.search(header) if isinstance(signature, re.Pattern) else header.endswith(" " + signature)
        if ok:
            end = text.index(".end method", m.end()) + len(".end method")
            hits.append((m.start(), end))
    if len(hits) != 1:
        raise PatchError(f"method {signature!r}: expected 1 match, got {len(hits)}")
    return hits[0]


def replace_method_body(path: Path, signature, body: str) -> None:
    """Keep the .method header line, replace everything up to .end method."""
    text = path.read_text(encoding="utf-8")
    start, end = find_method(text, signature)
    header = text[start:text.index("\n", start)]
    new = header + "\n" + body.strip("\n") + "\n.end method"
    path.write_text(text[:start] + new + text[end:], encoding="utf-8", newline="\n")


def smali_str(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')
