#!/usr/bin/env python3
"""Convert every PDF page under material/ into local JPEG images.

This script does not call any AI API and does not upload PDFs or images.
It uses Poppler's pdfinfo and pdftoppm locally, and writes images to a
separate output folder while preserving the source folder structure.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys
from datetime import datetime, timezone


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def require_tool(name_or_path: str) -> str:
    if Path(name_or_path).exists():
        return name_or_path
    found = shutil.which(name_or_path)
    if not found:
        raise SystemExit(f"Required tool not found on PATH: {name_or_path}")
    return found


def run_tool(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, text=True, capture_output=True, check=False)


def pdf_page_count(pdfinfo: str, pdf_path: Path) -> int:
    result = run_tool([pdfinfo, str(pdf_path)])
    if result.returncode != 0:
        raise RuntimeError(f"pdfinfo failed for {pdf_path}: {result.stderr.strip()}")
    for line in result.stdout.splitlines():
        if line.startswith("Pages:"):
            return int(line.split(":", 1)[1].strip())
    raise RuntimeError(f"Could not read page count from pdfinfo output: {pdf_path}")


def output_dir_for_pdf(material_dir: Path, output_dir: Path, pdf_path: Path) -> Path:
    relative_pdf = pdf_path.relative_to(material_dir)
    return output_dir / relative_pdf.with_suffix("")


def expected_page_path(pdf_output_dir: Path, page_number: int, image_format: str) -> Path:
    return pdf_output_dir / f"page-{page_number:04d}.{image_format}"


def write_manifest(output_dir: Path, manifest: dict) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = output_dir / "manifest.json"
    tmp_path = manifest_path.with_suffix(".json.tmp")
    tmp_path.write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")
    tmp_path.replace(manifest_path)


def render_page(args: argparse.Namespace, pdf_path: Path, page_number: int, page_path: Path) -> None:
    page_path.parent.mkdir(parents=True, exist_ok=True)
    prefix = page_path.with_suffix("")
    command = [
        args.pdftoppm,
        "-f",
        str(page_number),
        "-l",
        str(page_number),
        "-r",
        str(args.dpi),
    ]

    if args.format == "jpg":
        command.extend(["-jpeg", "-jpegopt", f"quality={args.jpeg_quality}"])
    else:
        command.append("-png")

    command.extend(["-singlefile", str(pdf_path), str(prefix)])
    result = run_tool(command)
    if result.returncode != 0:
        raise RuntimeError(
            f"pdftoppm failed for {pdf_path} page {page_number}: {result.stderr.strip()}"
        )
    if not page_path.exists() or page_path.stat().st_size == 0:
        raise RuntimeError(f"Expected image was not created: {page_path}")


def convert(args: argparse.Namespace) -> int:
    material_dir = args.material.resolve()
    output_dir = args.output.resolve()
    args.pdfinfo = require_tool(args.pdfinfo)
    args.pdftoppm = require_tool(args.pdftoppm)

    if not material_dir.exists():
        raise SystemExit(f"Material folder does not exist: {material_dir}")
    if material_dir == output_dir or material_dir in output_dir.parents:
        raise SystemExit("Output folder must be separate from and outside the material folder.")

    pdfs = sorted(material_dir.rglob("*.pdf"), key=lambda path: path.as_posix().lower())
    if args.limit_pdfs:
        pdfs = pdfs[: args.limit_pdfs]

    manifest = {
        "created_at": utc_now(),
        "updated_at": utc_now(),
        "material": str(material_dir),
        "output": str(output_dir),
        "dpi": args.dpi,
        "format": args.format,
        "jpeg_quality": args.jpeg_quality if args.format == "jpg" else None,
        "pdf_count": len(pdfs),
        "pages": [],
    }

    total_pages = 0
    converted_pages = 0
    skipped_pages = 0
    failed_pages = 0

    for pdf_index, pdf_path in enumerate(pdfs, start=1):
        page_count = pdf_page_count(args.pdfinfo, pdf_path)
        pdf_output_dir = output_dir_for_pdf(material_dir, output_dir, pdf_path)
        print(f"[{pdf_index}/{len(pdfs)}] {pdf_path.relative_to(material_dir)} ({page_count} pages)")

        for page_number in range(1, page_count + 1):
            if args.limit_pages and total_pages >= args.limit_pages:
                manifest["updated_at"] = utc_now()
                manifest["total_pages"] = total_pages
                manifest["converted_pages"] = converted_pages
                manifest["skipped_pages"] = skipped_pages
                manifest["failed_pages"] = failed_pages
                write_manifest(output_dir, manifest)
                print_summary(total_pages, converted_pages, skipped_pages, failed_pages, output_dir)
                return 0 if failed_pages == 0 else 1

            total_pages += 1
            page_path = expected_page_path(pdf_output_dir, page_number, args.format)
            page_record = {
                "pdf": pdf_path.relative_to(material_dir).as_posix(),
                "page": page_number,
                "image": page_path.relative_to(output_dir).as_posix(),
                "status": "pending",
            }

            if page_path.exists() and page_path.stat().st_size > 0 and not args.overwrite:
                skipped_pages += 1
                page_record["status"] = "skipped_existing"
                manifest["pages"].append(page_record)
                continue

            if args.dry_run:
                skipped_pages += 1
                page_record["status"] = "dry_run"
                manifest["pages"].append(page_record)
                continue

            try:
                render_page(args, pdf_path, page_number, page_path)
                converted_pages += 1
                page_record["status"] = "converted"
            except Exception as exc:
                failed_pages += 1
                page_record["status"] = "failed"
                page_record["error"] = str(exc)
                print(f"  failed page {page_number}: {exc}", file=sys.stderr)
                if not args.keep_going:
                    manifest["pages"].append(page_record)
                    manifest["updated_at"] = utc_now()
                    manifest["total_pages"] = total_pages
                    manifest["converted_pages"] = converted_pages
                    manifest["skipped_pages"] = skipped_pages
                    manifest["failed_pages"] = failed_pages
                    write_manifest(output_dir, manifest)
                    return 1

            manifest["pages"].append(page_record)

        if pdf_index % args.manifest_every == 0:
            manifest["updated_at"] = utc_now()
            manifest["total_pages"] = total_pages
            manifest["converted_pages"] = converted_pages
            manifest["skipped_pages"] = skipped_pages
            manifest["failed_pages"] = failed_pages
            write_manifest(output_dir, manifest)

    manifest["updated_at"] = utc_now()
    manifest["total_pages"] = total_pages
    manifest["converted_pages"] = converted_pages
    manifest["skipped_pages"] = skipped_pages
    manifest["failed_pages"] = failed_pages
    write_manifest(output_dir, manifest)
    print_summary(total_pages, converted_pages, skipped_pages, failed_pages, output_dir)
    return 0 if failed_pages == 0 else 1


def print_summary(
    total_pages: int,
    converted_pages: int,
    skipped_pages: int,
    failed_pages: int,
    output_dir: Path,
) -> None:
    print(
        "Done: "
        f"total_pages={total_pages}, "
        f"converted={converted_pages}, "
        f"skipped={skipped_pages}, "
        f"failed={failed_pages}"
    )
    print(f"Images folder: {output_dir}")
    print(f"Manifest: {output_dir / 'manifest.json'}")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Convert PDFs under material/ to local page images.")
    parser.add_argument("--material", type=Path, default=Path("material"), help="Source PDF folder.")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("converted-images"),
        help="Separate folder for converted page images.",
    )
    parser.add_argument("--format", choices=["jpg", "png"], default="jpg")
    parser.add_argument("--dpi", type=int, default=150)
    parser.add_argument("--jpeg-quality", type=int, default=88)
    parser.add_argument("--pdfinfo", default="pdfinfo")
    parser.add_argument("--pdftoppm", default="pdftoppm")
    parser.add_argument("--overwrite", action="store_true", help="Recreate images that already exist.")
    parser.add_argument("--keep-going", action="store_true", help="Continue if one page fails.")
    parser.add_argument("--dry-run", action="store_true", help="Count pages and planned outputs only.")
    parser.add_argument("--limit-pdfs", type=int, default=0, help="Testing only: limit number of PDFs.")
    parser.add_argument("--limit-pages", type=int, default=0, help="Testing only: limit number of pages.")
    parser.add_argument("--manifest-every", type=int, default=5, help="Write manifest after this many PDFs.")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    return convert(parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
