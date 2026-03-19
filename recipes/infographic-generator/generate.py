#!/usr/bin/env python3
"""
Infographic image generator using Google Gemini API.
Called by the infographic-generator skill after prompts are written.

Usage:
  python3 generate.py <prompts-file.md> [--output-dir ./media] [--premium] [--redo N]

Environment:
  GEMINI_API_KEY  - Required. Get a free key at https://ai.google.dev

Flags:
  --premium    Use higher-quality model (may require paid API key)
  --redo N     Regenerate only infographic #N from the file
"""

import sys
import os
import re
import argparse
import json
from pathlib import Path

# Use the skill's venv if available
VENV_SITE = Path(__file__).parent / ".venv" / "lib"
for p in VENV_SITE.glob("python*/site-packages"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from google import genai
from google.genai import types

API_KEY = os.environ.get("GEMINI_API_KEY", "")
if not API_KEY:
    print("ERROR: GEMINI_API_KEY environment variable is not set.")
    print("Get a free key at https://ai.google.dev")
    sys.exit(1)

MODEL_FREE = "gemini-2.5-flash-image"
MODEL_PREMIUM = "gemini-3.1-flash-image-preview"


def extract_prompts(md_path):
    """Extract prompt blocks from the markdown file."""
    text = Path(md_path).read_text()

    # Split on "## Infographic" headers
    sections = re.split(r"(?=## Infographic \d+)", text)
    prompts = []

    for section in sections:
        # Find the title
        title_match = re.match(r'## Infographic \d+:\s*["\']?(.+?)["\']?\s*$', section, re.MULTILINE)
        if not title_match:
            continue
        title = title_match.group(1).strip().strip('"\'')

        # Find the prompt content (everything after "### Prompt" line)
        prompt_match = re.search(r'### Prompt.*?\n\n(.+?)(?=\n---|\n## |\Z)', section, re.DOTALL)
        if not prompt_match:
            continue

        prompt_text = prompt_match.group(1).strip()

        # Extract aspect ratio if specified
        ar_match = re.search(r'Aspect ratio:\s*(\d+:\d+)', section)
        aspect_ratio = ar_match.group(1) if ar_match else "4:5"

        # Clean the title for filename
        safe_name = re.sub(r'[^\w\s-]', '', title.lower())
        safe_name = re.sub(r'[\s]+', '-', safe_name).strip('-')[:60]

        prompts.append({
            "title": title,
            "prompt": prompt_text,
            "aspect_ratio": aspect_ratio,
            "filename": safe_name + ".png",
        })

    return prompts


def generate_image(client, model, prompt_data):
    """Generate a single infographic image."""
    try:
        response = client.models.generate_content(
            model=model,
            contents=prompt_data["prompt"],
            config=types.GenerateContentConfig(
                response_modalities=["IMAGE"],
                image_config=types.ImageConfig(
                    aspect_ratio=prompt_data["aspect_ratio"],
                ),
            ),
        )

        for part in response.parts:
            if part.inline_data:
                return part.as_image()
    except Exception as e:
        print(f"  Generation error: {e}")
        # Retry once
        print("  Retrying...")
        try:
            response = client.models.generate_content(
                model=model,
                contents=prompt_data["prompt"],
                config=types.GenerateContentConfig(
                    response_modalities=["IMAGE"],
                    image_config=types.ImageConfig(
                        aspect_ratio=prompt_data["aspect_ratio"],
                    ),
                ),
            )
            for part in response.parts:
                if part.inline_data:
                    return part.as_image()
        except Exception as retry_error:
            print(f"  Retry failed: {retry_error}")

    return None


def main():
    parser = argparse.ArgumentParser(description="Generate infographic images from prompt markdown")
    parser.add_argument("prompts_file", help="Path to the prompts markdown file")
    parser.add_argument("--output-dir", default="./media", help="Output directory for images")
    parser.add_argument("--premium", action="store_true", help="Use higher-quality model (may require paid key)")
    parser.add_argument("--redo", type=int, help="Regenerate only infographic #N")
    args = parser.parse_args()

    model = MODEL_PREMIUM if args.premium else MODEL_FREE
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Model: {model} ({'premium' if args.premium else 'free tier'})")
    print(f"Output: {output_dir}")

    prompts = extract_prompts(args.prompts_file)
    if not prompts:
        print("ERROR: No prompts found in file.")
        print("Expected format: '## Infographic N: Title' followed by '### Prompt' section")
        sys.exit(1)

    print(f"Found {len(prompts)} prompts")

    # Filter to single prompt if --redo
    if args.redo:
        idx = args.redo - 1
        if idx < 0 or idx >= len(prompts):
            print(f"ERROR: --redo {args.redo} out of range (1-{len(prompts)})")
            sys.exit(1)
        prompts = [prompts[idx]]
        print(f"Regenerating only: #{args.redo} - {prompts[0]['title']}")

    client = genai.Client(api_key=API_KEY)

    results = []
    for i, p in enumerate(prompts):
        num = args.redo if args.redo else i + 1
        total = len(prompts) if not args.redo else args.redo
        print(f"\n[{num}/{total}] Generating: {p['title']}")
        print(f"  Aspect ratio: {p['aspect_ratio']}")

        image = generate_image(client, model, p)
        if image:
            out_path = output_dir / p["filename"]
            image.save(str(out_path))
            print(f"  SAVED: {out_path}")
            results.append({"file": p["filename"], "caption": p["title"], "path": str(out_path)})
        else:
            print(f"  FAILED: No image generated")

    # Print summary
    print(f"\n{'='*50}")
    print(f"Generated {len(results)}/{len(prompts)} images")
    for r in results:
        print(f"  {r['file']}")

    # Output JSON manifest for the skill to consume
    if results:
        manifest_path = output_dir / "_latest_generation.json"
        with open(manifest_path, "w") as f:
            json.dump(results, f, indent=2)
        print(f"\nManifest: {manifest_path}")


if __name__ == "__main__":
    main()
