#!/usr/bin/env python3
"""
Preprocesador de imágenes de exámenes manuscritos.
Mejora contraste, enfoque y resolución para facilitar la lectura de letra manuscrita.

Uso:
    python3 preprocess_image.py <imagen_entrada> <imagen_salida>
    python3 preprocess_image.py <carpeta_entrada> <carpeta_salida>  (modo lote)
"""

import sys
import os
import subprocess
import shutil


def find_convert():
    """Encuentra el comando convert de ImageMagick."""
    for cmd in ["magick", "convert"]:
        path = shutil.which(cmd)
        if path:
            return path
    return None


def preprocess_single(input_path, output_path, convert_cmd):
    """Preprocesa una sola imagen."""
    # Get image dimensions
    try:
        result = subprocess.run(
            [convert_cmd, input_path, "-format", "%w", "info:"],
            capture_output=True, text=True, timeout=30
        )
        width = int(result.stdout.strip()) if result.stdout.strip() else 0
    except (subprocess.TimeoutExpired, ValueError):
        width = 0

    # Build the ImageMagick pipeline
    args = [convert_cmd, input_path]

    # 1. Convert to grayscale
    args.extend(["-colorspace", "Gray"])

    # 2. Increase resolution if small (< 2000px wide)
    if width > 0 and width < 2000:
        scale_factor = max(200, int(2000 / width * 100))
        args.extend(["-resize", f"{scale_factor}%"])

    # 3. Adaptive contrast enhancement (similar to CLAHE)
    # Using contrast-stretch to normalize the histogram
    args.extend(["-contrast-stretch", "2%x2%"])

    # 4. Normalize levels for better black/white separation
    args.extend(["-normalize"])

    # 5. Sharpen to make text edges crisper
    args.extend(["-sharpen", "0x1.5"])

    # 6. Slight unsharp mask for fine detail enhancement
    args.extend(["-unsharp", "0x1+0.8+0.05"])

    # 7. Increase local contrast (helps with faint pencil/pen)
    args.extend(["-local-threshold", "15"])

    # 8. Output as high-quality JPG
    args.extend(["-quality", "95", output_path])

    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=60)
        if result.returncode != 0:
            # Fallback: simpler pipeline without -local-threshold (not all versions support it)
            args_simple = [convert_cmd, input_path, "-colorspace", "Gray"]
            if width > 0 and width < 2000:
                args_simple.extend(["-resize", "200%"])
            args_simple.extend([
                "-contrast-stretch", "3%x3%",
                "-normalize",
                "-sharpen", "0x2",
                "-unsharp", "0x1+1.0+0.05",
                "-quality", "95",
                output_path
            ])
            subprocess.run(args_simple, capture_output=True, text=True, timeout=60, check=True)
            print(f"  [OK - fallback] {os.path.basename(input_path)} -> {os.path.basename(output_path)}")
        else:
            print(f"  [OK] {os.path.basename(input_path)} -> {os.path.basename(output_path)}")
    except subprocess.CalledProcessError as e:
        print(f"  [ERROR] {os.path.basename(input_path)}: {e.stderr}", file=sys.stderr)
        # Last resort: just copy the file
        shutil.copy2(input_path, output_path)
        print(f"  [COPY] Copiada sin procesar: {os.path.basename(input_path)}")


def convert_heic_to_jpg(input_path, output_path, convert_cmd):
    """Convierte HEIC a JPG antes de preprocesar."""
    try:
        subprocess.run(
            [convert_cmd, input_path, "-quality", "95", output_path],
            capture_output=True, text=True, timeout=60, check=True
        )
        return output_path
    except subprocess.CalledProcessError:
        print(f"  [WARN] No se pudo convertir HEIC: {input_path}", file=sys.stderr)
        return None


def main():
    if len(sys.argv) < 3:
        print("Uso: python3 preprocess_image.py <entrada> <salida>")
        print("  entrada/salida pueden ser archivos o carpetas")
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]

    convert_cmd = find_convert()
    if not convert_cmd:
        print("ERROR: ImageMagick no encontrado. Instala con: apt install imagemagick", file=sys.stderr)
        sys.exit(1)

    image_extensions = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".heic", ".heif"}

    if os.path.isdir(input_path):
        # Batch mode
        os.makedirs(output_path, exist_ok=True)
        files = sorted([
            f for f in os.listdir(input_path)
            if os.path.splitext(f)[1].lower() in image_extensions
        ])
        print(f"Preprocesando {len(files)} imágenes...")
        for f in files:
            in_file = os.path.join(input_path, f)
            base, ext = os.path.splitext(f)

            # Convert HEIC first if needed
            if ext.lower() in {".heic", ".heif"}:
                temp_jpg = os.path.join(output_path, f"{base}_temp.jpg")
                converted = convert_heic_to_jpg(in_file, temp_jpg, convert_cmd)
                if converted:
                    out_file = os.path.join(output_path, f"{base}.jpg")
                    preprocess_single(converted, out_file, convert_cmd)
                    os.remove(temp_jpg)
                continue

            out_file = os.path.join(output_path, f"{base}_enhanced.jpg")
            preprocess_single(in_file, out_file, convert_cmd)

        print(f"\nListo. Imágenes mejoradas en: {output_path}")

    elif os.path.isfile(input_path):
        # Single file mode
        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
        base, ext = os.path.splitext(input_path)

        if ext.lower() in {".heic", ".heif"}:
            temp_jpg = output_path + "_temp.jpg"
            converted = convert_heic_to_jpg(input_path, temp_jpg, convert_cmd)
            if converted:
                preprocess_single(converted, output_path, convert_cmd)
                os.remove(temp_jpg)
            else:
                sys.exit(1)
        else:
            preprocess_single(input_path, output_path, convert_cmd)
    else:
        print(f"ERROR: No se encuentra: {input_path}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
