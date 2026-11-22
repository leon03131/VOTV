"""Keep the original client id in the User-Agent.

Cobalt sends "<packageName>/<versionName>" to youtube.com; with a renamed
package the server would see an unknown client.
"""
from __future__ import annotations

from . import Ctx, replace_method_body, smali_str


def apply(ctx: Ctx) -> None:
    value = f"{ctx.cfg['original_package']}/{ctx.cfg['original_version']}"
    path = ctx.class_file("Ldev/cobalt/coat/BaseStarboardBridge;")
    replace_method_body(
        path,
        "getUserAgentAuxField()Ljava/lang/String;",
        f"""
    .locals 1
    const-string v0, "{smali_str(value)}"
    return-object v0
""",
    )
    ctx.note(f"User-Agent client id -> {value}")
