#!/usr/bin/env python3
"""Package the extension for Mozilla Add-ons without compiling its scripts."""

import json
from pathlib import Path
import re
import zipfile


# main()
# Check the manifest and package only runtime files and the license.
def main():
    root = Path(__file__).resolve().parent
    manifest = json.loads((root / "manifest.json").read_text())
    version = manifest["version"]
    if not re.fullmatch(r"\d+(?:\.\d+){0,3}", version):
        raise ValueError("The manifest version must contain one to four numbers")

    # Keep screenshots, documentation, and development files out of the ZIP.
    files = ["manifest.json", "background.js", "content.js", "page.js", "LICENSE"]
    files += sorted(str(path.relative_to(root)) for path in (root / "icons").iterdir()
                    if path.is_file() and path.suffix in {".png", ".svg"})
    referenced = [*manifest["background"]["scripts"],
                  *manifest["icons"].values(), *manifest["action"]["default_icon"].values()]
    referenced += [f"icons/{mode}-{size}.svg" for mode in ("auto", "dark", "light")
                   for size in (16, 32)]
    for script in manifest["content_scripts"]:
        referenced += script["js"]
    for name in referenced:
        if name not in files or not (root / name).is_file():
            raise ValueError(f"Missing packaged file: {name}")

    # Build beside the final archive, then replace it only after ZIP creation.
    output = root / "dist" / f"paletmin-firefox-{version}.zip"
    output.parent.mkdir(exist_ok=True)
    temporary = output.with_suffix(".zip.tmp")
    try:
        with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED) as archive:
            for name in files:
                archive.write(root / name, name)
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    print(output)


if __name__ == "__main__":
    main()
