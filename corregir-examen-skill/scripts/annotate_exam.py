#!/usr/bin/env python3
"""
Anotador de exámenes manuscritos.
Superpone correcciones (ticks, cruces, comentarios, nota) sobre las fotos originales
del examen, simulando las marcas que haría un docente con bolígrafo rojo/verde.

Uso:
    python3 annotate_exam.py <imagen_examen> <json_correcciones> <imagen_salida>

El JSON de correcciones debe tener esta estructura:
{
    "student_name": "David",
    "student_group": "3ºC",
    "subject": "Física y Química",
    "total_grade": "3,2/10",
    "pages": [
        {
            "page_number": 1,
            "annotations": [
                {
                    "y_percent": 35,
                    "type": "correct",
                    "text": null
                },
                {
                    "y_percent": 40,
                    "type": "incorrect",
                    "text": "Ácido sulfúrico"
                },
                {
                    "y_percent": 45,
                    "type": "partial",
                    "text": "Falta: hierro(III)"
                },
                {
                    "y_percent": 70,
                    "type": "comment",
                    "text": "Confundes ácidos con sales. Recuerda: si empieza por H → ácido"
                }
            ],
            "page_grade": "1,8/3"
        }
    ]
}

Tipos de anotación:
- "correct": tick verde (✓)
- "incorrect": cruz roja (✗) + texto con corrección
- "partial": tilde naranja (~) + texto con lo que falta
- "comment": comentario en azul en el margen
- "underline_error": subraya en rojo una zona
- "page_grade": nota del bloque (se coloca abajo)
"""

import json
import sys
import os
from PIL import Image, ImageDraw, ImageFont


# ─── Colores ───
RED = (210, 40, 40)
GREEN = (0, 145, 60)
ORANGE = (210, 130, 0)
BLUE = (30, 70, 170)
WHITE = (255, 255, 255)
LIGHT_RED = (255, 220, 220, 160)
LIGHT_GREEN = (220, 255, 220, 160)
LIGHT_ORANGE = (255, 240, 210, 160)
LIGHT_BLUE = (220, 230, 255, 180)
GRADE_BG = (240, 240, 255, 200)


def load_fonts(base_size):
    """Carga fuentes escaladas al tamaño de la imagen."""
    paths = [
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
        '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    ]

    bold_path = None
    regular_path = None
    for p in paths:
        if os.path.exists(p):
            if 'Bold' in p and not bold_path:
                bold_path = p
            elif not regular_path:
                regular_path = p

    if not regular_path:
        regular_path = bold_path
    if not bold_path:
        bold_path = regular_path

    fonts = {}
    if bold_path:
        fonts['symbol'] = ImageFont.truetype(bold_path, int(base_size * 1.6))
        fonts['grade'] = ImageFont.truetype(bold_path, int(base_size * 1.3))
        fonts['grade_big'] = ImageFont.truetype(bold_path, int(base_size * 2.0))
        fonts['label'] = ImageFont.truetype(bold_path, int(base_size * 0.75))
    if regular_path:
        fonts['text'] = ImageFont.truetype(regular_path, int(base_size * 0.8))
        fonts['comment'] = ImageFont.truetype(regular_path, int(base_size * 0.7))
        fonts['small'] = ImageFont.truetype(regular_path, int(base_size * 0.6))

    if not fonts:
        default = ImageFont.load_default()
        fonts = {k: default for k in ['symbol', 'grade', 'grade_big', 'label', 'text', 'comment', 'small']}

    return fonts


def draw_rounded_rect(draw, xy, radius, fill, outline=None, width=1):
    """Dibuja un rectángulo con esquinas redondeadas."""
    x1, y1, x2, y2 = xy
    r = radius
    # Esquinas
    draw.ellipse([x1, y1, x1 + 2*r, y1 + 2*r], fill=fill, outline=outline, width=width)
    draw.ellipse([x2 - 2*r, y1, x2, y1 + 2*r], fill=fill, outline=outline, width=width)
    draw.ellipse([x1, y2 - 2*r, x1 + 2*r, y2], fill=fill, outline=outline, width=width)
    draw.ellipse([x2 - 2*r, y2 - 2*r, x2, y2], fill=fill, outline=outline, width=width)
    # Rectángulos de relleno
    draw.rectangle([x1 + r, y1, x2 - r, y2], fill=fill)
    draw.rectangle([x1, y1 + r, x2, y2 - r], fill=fill)
    # Bordes
    if outline:
        draw.line([x1 + r, y1, x2 - r, y1], fill=outline, width=width)
        draw.line([x1 + r, y2, x2 - r, y2], fill=outline, width=width)
        draw.line([x1, y1 + r, x1, y2 - r], fill=outline, width=width)
        draw.line([x2, y1 + r, x2, y2 - r], fill=outline, width=width)


def wrap_text(text, font, max_width, draw):
    """Divide texto en líneas que caben en max_width."""
    words = text.split()
    lines = []
    current = ""
    for word in words:
        test = f"{current} {word}".strip()
        bbox = draw.textbbox((0, 0), test, font=font)
        if bbox[2] - bbox[0] <= max_width:
            current = test
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def annotate_page(img, page_data, fonts):
    """Anota una página del examen."""
    width, height = img.size

    # Crear capa de overlay transparente
    overlay = Image.new('RGBA', img.size, (0, 0, 0, 0))
    overlay_draw = ImageDraw.Draw(overlay)

    # Convertir imagen base a RGBA
    if img.mode != 'RGBA':
        img = img.convert('RGBA')

    # Márgenes para anotaciones
    # Las anotaciones van en el margen derecho (último 30% de la imagen)
    margin_x = int(width * 0.72)  # Donde empiezan las anotaciones de margen
    margin_width = int(width * 0.26)  # Ancho disponible para texto

    # Posición del tick/cruz (justo antes del margen)
    mark_x = int(width * 0.68)

    annotations = page_data.get('annotations', [])

    for ann in annotations:
        y_pct = ann.get('y_percent', 50)
        y = int(height * y_pct / 100)
        ann_type = ann.get('type', 'comment')
        text = ann.get('text', '')

        if ann_type == 'correct':
            # ✓ verde con fondo suave
            symbol_bbox = overlay_draw.textbbox((0, 0), '✓', font=fonts['symbol'])
            sw = symbol_bbox[2] - symbol_bbox[0]
            sh = symbol_bbox[3] - symbol_bbox[1]

            # Fondo circular verde claro
            cx, cy = mark_x, y
            r = int(max(sw, sh) * 0.8)
            overlay_draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(200, 255, 200, 120))

            # Símbolo
            overlay_draw.text((cx - sw//2, cy - sh//2 - 4), '✓', fill=GREEN, font=fonts['symbol'])

        elif ann_type == 'incorrect':
            # ✗ roja con corrección
            symbol_bbox = overlay_draw.textbbox((0, 0), '✗', font=fonts['symbol'])
            sw = symbol_bbox[2] - symbol_bbox[0]
            sh = symbol_bbox[3] - symbol_bbox[1]

            # Fondo circular rojo claro
            cx, cy = mark_x, y
            r = int(max(sw, sh) * 0.8)
            overlay_draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 210, 210, 130))

            # Símbolo
            overlay_draw.text((cx - sw//2, cy - sh//2 - 4), '✗', fill=RED, font=fonts['symbol'])

            # Texto de corrección en el margen
            if text:
                lines = wrap_text(f"→ {text}", fonts['text'], margin_width, overlay_draw)
                text_y = y - 8
                # Fondo para el texto
                total_h = len(lines) * int(fonts['text'].size * 1.4) + 12
                draw_rounded_rect(overlay_draw,
                    [margin_x - 6, text_y - 4, margin_x + margin_width + 6, text_y + total_h],
                    radius=6, fill=(255, 235, 235, 180), outline=(210, 40, 40, 150), width=1)

                for line in lines:
                    overlay_draw.text((margin_x, text_y), line, fill=RED, font=fonts['text'])
                    text_y += int(fonts['text'].size * 1.4)

        elif ann_type == 'partial':
            # ~ naranja con nota
            symbol_bbox = overlay_draw.textbbox((0, 0), '~', font=fonts['symbol'])
            sw = symbol_bbox[2] - symbol_bbox[0]
            sh = symbol_bbox[3] - symbol_bbox[1]

            cx, cy = mark_x, y
            r = int(max(sw, sh) * 0.8)
            overlay_draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 235, 200, 130))
            overlay_draw.text((cx - sw//2, cy - sh//2 - 4), '~', fill=ORANGE, font=fonts['symbol'])

            if text:
                lines = wrap_text(text, fonts['text'], margin_width, overlay_draw)
                text_y = y - 8
                total_h = len(lines) * int(fonts['text'].size * 1.4) + 12
                draw_rounded_rect(overlay_draw,
                    [margin_x - 6, text_y - 4, margin_x + margin_width + 6, text_y + total_h],
                    radius=6, fill=(255, 245, 225, 180), outline=(210, 130, 0, 150), width=1)

                for line in lines:
                    overlay_draw.text((margin_x, text_y), line, fill=ORANGE, font=fonts['text'])
                    text_y += int(fonts['text'].size * 1.4)

        elif ann_type == 'comment':
            # Comentario en azul en el margen
            if text:
                lines = wrap_text(text, fonts['comment'], margin_width, overlay_draw)
                text_y = y
                total_h = len(lines) * int(fonts['comment'].size * 1.4) + 16

                # Fondo azul claro con borde
                draw_rounded_rect(overlay_draw,
                    [margin_x - 8, text_y - 6, margin_x + margin_width + 8, text_y + total_h],
                    radius=8, fill=(225, 235, 255, 190), outline=(30, 70, 170, 180), width=2)

                # Icono de comentario
                overlay_draw.text((margin_x, text_y), "💬", font=fonts['small'])
                text_y += int(fonts['comment'].size * 1.2)

                for line in lines:
                    overlay_draw.text((margin_x + 2, text_y), line, fill=BLUE, font=fonts['comment'])
                    text_y += int(fonts['comment'].size * 1.4)

    # Nota del bloque (abajo a la derecha)
    page_grade = page_data.get('page_grade')
    if page_grade:
        grade_text = f"Bloque: {page_grade}"
        bbox = overlay_draw.textbbox((0, 0), grade_text, font=fonts['grade'])
        gw = bbox[2] - bbox[0]
        gh = bbox[3] - bbox[1]

        gx = width - gw - 50
        gy = height - gh - 50

        draw_rounded_rect(overlay_draw,
            [gx - 15, gy - 10, gx + gw + 15, gy + gh + 10],
            radius=10, fill=(235, 235, 255, 210), outline=BLUE, width=2)
        overlay_draw.text((gx, gy), grade_text, fill=BLUE, font=fonts['grade'])

    # Componer
    result = Image.alpha_composite(img, overlay)
    return result


def add_grade_header(img, total_grade, student_name, fonts):
    """Añade la nota total como cabecera en la primera página."""
    width, height = img.size

    overlay = Image.new('RGBA', img.size, (0, 0, 0, 0))
    overlay_draw = ImageDraw.Draw(overlay)

    if img.mode != 'RGBA':
        img = img.convert('RGBA')

    # Nota total arriba a la derecha
    grade_text = total_grade
    bbox = overlay_draw.textbbox((0, 0), grade_text, font=fonts['grade_big'])
    gw = bbox[2] - bbox[0]
    gh = bbox[3] - bbox[1]

    gx = width - gw - 60
    gy = 35

    # Recuadro con fondo
    draw_rounded_rect(overlay_draw,
        [gx - 20, gy - 12, gx + gw + 20, gy + gh + 12],
        radius=12, fill=(240, 240, 255, 220), outline=BLUE, width=3)
    overlay_draw.text((gx, gy), grade_text, fill=BLUE, font=fonts['grade_big'])

    result = Image.alpha_composite(img, overlay)
    return result


def annotate_exam(image_paths, corrections_data, output_dir):
    """
    Procesa todas las páginas de un examen.

    Args:
        image_paths: lista de rutas a las imágenes de cada página
        corrections_data: dict con la estructura de correcciones
        output_dir: carpeta donde guardar las imágenes anotadas
    """
    os.makedirs(output_dir, exist_ok=True)

    pages = corrections_data.get('pages', [])
    total_grade = corrections_data.get('total_grade', '')
    student_name = corrections_data.get('student_name', 'Alumno')

    # Calcular tamaño base de fuente según la imagen más grande
    sample_img = Image.open(image_paths[0])
    base_size = max(18, int(sample_img.size[0] / 50))
    sample_img.close()

    fonts = load_fonts(base_size)

    output_paths = []

    for i, img_path in enumerate(image_paths):
        img = Image.open(img_path)

        if i < len(pages):
            img = annotate_page(img, pages[i], fonts)

        # Añadir nota total en la primera página
        if i == 0 and total_grade:
            img = add_grade_header(img, total_grade, student_name, fonts)

        # Guardar
        output_name = f"{student_name}_p{i+1}_corregido.jpg"
        output_path = os.path.join(output_dir, output_name)
        img.convert('RGB').save(output_path, quality=95)
        output_paths.append(output_path)
        print(f"  [OK] {output_name}")

    return output_paths


def main():
    if len(sys.argv) < 4:
        print("Uso: python3 annotate_exam.py <imagen(es)> <json_correcciones> <carpeta_salida>")
        print("  Para múltiples imágenes, sepáralas con comas:")
        print("  python3 annotate_exam.py img1.jpg,img2.jpg,img3.jpg correcciones.json salida/")
        sys.exit(1)

    image_arg = sys.argv[1]
    json_path = sys.argv[2]
    output_dir = sys.argv[3]

    # Parsear imágenes (separadas por comas)
    image_paths = [p.strip() for p in image_arg.split(',')]

    # Cargar correcciones
    with open(json_path, 'r', encoding='utf-8') as f:
        corrections = json.load(f)

    print(f"Anotando examen de {corrections.get('student_name', '?')}...")
    print(f"  Páginas: {len(image_paths)}")
    print()

    results = annotate_exam(image_paths, corrections, output_dir)

    print(f"\nListo. {len(results)} páginas anotadas en: {output_dir}")


if __name__ == "__main__":
    main()
