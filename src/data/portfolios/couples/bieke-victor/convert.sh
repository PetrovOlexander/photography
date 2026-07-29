#!/usr/bin/env bash

# ─── Settings ────────────────────────────────────────────────────────────────
QUALITY=100        # Perceptual quality 0–100 (90 is a safe high-quality default)
METHOD=6          # Compression effort 0 (fast) – 6 (best quality/smallest file)
ALPHA_Q=100       # Alpha channel quality 0–100 (100 = lossless alpha)
METADATA="icc,exif" # Metadata to keep: none | all | icc | exif | xmp
OUT_DIR="webp"
# ─────────────────────────────────────────────────────────────────────────────

mkdir -p "$OUT_DIR"
shopt -s nullglob   # skip loop if no files match
shopt -s nocaseglob # match .JPG, .jpg, etc.

converted=0
skipped=0

for file in *.{png,jpg,jpeg,tiff,tif}; do
  out="$OUT_DIR/${file%.*}.webp"

  # Skip if webp already exists and is newer than source
  if [[ -f "$out" && "$out" -nt "$file" ]]; then
    echo "  skip  $file (up to date)"
    ((skipped++))
    continue
  fi

  echo "  →  $file"
  cwebp \
    -q "$QUALITY" \
    -m "$METHOD" \
    -alpha_q "$ALPHA_Q" \
    -metadata "$METADATA" \
    -mt \
    -sharp_yuv \
    "$file" -o "$out"

  ((converted++))
done

echo ""
echo "Done — converted: $converted  |  skipped (up to date): $skipped"