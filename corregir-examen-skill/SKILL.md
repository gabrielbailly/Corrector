---
name: corregir-examen
description: >
  Skill para corregir exámenes manuscritos de alumnado a partir de fotos.
  Lee letra manuscrita de estudiantes, corrige cada pregunta, genera feedback
  formativo personalizado (puntos fuertes, aspectos a mejorar, feedforward) y
  entrega un .docx profesional por alumno/a. Soporta corrección por lotes.
  USA ESTE SKILL siempre que el usuario mencione: corregir exámenes, feedback
  de exámenes, evaluar respuestas de alumnos, leer exámenes manuscritos,
  corrección con IA, fotos de exámenes, retroalimentación formativa, o suba
  imágenes que parezcan hojas de examen escritas a mano. También si dice
  "corrige esto", "dame feedback de mis alumnos", "evalúa estas respuestas",
  o cualquier variación. Incluso si no dice "examen" pero sube fotos de
  escritura manuscrita en contexto educativo.
---

# Skill: Corregir Exámenes Manuscritos

## Qué hace este skill

Transforma fotos de exámenes escritos a mano en feedback formativo de calidad profesional. El flujo completo es:

1. Preprocesar las imágenes para mejorar la legibilidad
2. Leer e interpretar la escritura manuscrita
3. Corregir cada pregunta con rigor académico
4. Generar feedback formativo personalizado
5. Entregar resumen en chat + documento .docx por alumno/a

## Paso 0 — Recoger contexto mínimo

Antes de empezar, necesitas saber al menos:
- **Asignatura** (para interpretar correctamente términos técnicos manuscritos)
- **Curso/nivel** (para calibrar la exigencia y el tono del feedback)

Si el usuario ya lo ha proporcionado en su mensaje, no lo vuelvas a preguntar. Si no lo ha dicho, pídelo brevemente.

Información adicional que mejora la corrección si el usuario la proporciona voluntariamente (no la pidas tú):
- Criterios de evaluación o rúbrica
- Solucionario o respuestas esperadas
- Tono deseado (formal, cercano, motivador...)
- Puntuación por pregunta

## Paso 1 — Preprocesar imágenes

La letra manuscrita adolescente es difícil de leer. Antes de intentar interpretar nada, mejora las imágenes. Ejecuta el script de preprocesamiento:

```bash
python3 <skill-path>/scripts/preprocess_image.py <ruta_imagen> <ruta_salida>
```

Esto aumenta contraste, convierte a escala de grises, aplica enfoque y mejora resolución. Hazlo para CADA imagen antes de leerla.

Si el script no está disponible o falla, usa ImageMagick directamente:

```bash
convert <imagen> -colorspace Gray -contrast-stretch 3%x3% -sharpen 0x2 -resize 200% -quality 95 <salida.jpg>
```

## Paso 2 — Leer la escritura manuscrita

Lee las imágenes preprocesadas. Estas son las reglas clave para interpretar letra manuscrita de estudiantes:

### Estrategia de lectura

1. **Contexto antes que píxeles.** Si estás en un examen de Física y Química y algo parece "acido", es "ácido". Si parece "oxido", es "óxido". Usa el conocimiento de la asignatura para desambiguar trazos dudosos.

2. **Lee en bloques, no letra a letra.** La escritura manuscrita tiene ritmo. Intenta captar palabras completas y frases, no descifrar cada carácter aislado. El cerebro humano lee así y tú también deberías.

3. **Las fórmulas y números tienen patrones.** En ciencias, si ves algo como "H₂SO₄" con un número dudoso, es más probable que sea un subíndice químico conocido que un número aleatorio. Cruza con fórmulas reales.

4. **Marca lo ilegible con honestidad.** Si después de aplicar contexto y preprocesamiento no puedes leer algo con razonable confianza, márcalo como `[ilegible]` en tu transcripción. No inventes. Es mejor decir "no puedo leer esta palabra" que generar feedback basado en una lectura incorrecta.

5. **Distingue entre "no respondido" y "no legible".** Un espacio en blanco es una no-respuesta. Un garabato que no puedes leer es [ilegible]. Son cosas diferentes y el feedback cambia.

### Errores frecuentes de lectura a evitar

- Confundir "u" y "v" manuscritas (muy habitual en español)
- Confundir "a" y "o" cuando están cerradas
- Leer un "1" como "l" o viceversa en contextos numéricos
- No detectar subíndices o superíndices escritos a mano (fíjate en el tamaño relativo)
- Confundir el signo "=" con un "≡" o un garabato

## Paso 3 — Corregir cada pregunta

Para cada pregunta del examen:

1. **Transcribe** lo que ha escrito el alumno/a (tal cual, con errores incluidos)
2. **Evalúa** si la respuesta es correcta, parcialmente correcta o incorrecta
3. **Explica** el error concreto si lo hay (no basta con "incorrecto")
4. **Proporciona** la respuesta correcta como referencia
5. **Asigna** una puntuación orientativa si es posible inferir el baremo

Sé riguroso pero justo. Si el razonamiento es correcto pero hay un error de cálculo, reconoce el razonamiento. Si la respuesta final es correcta pero el proceso es incorrecto, señálalo.

## Paso 4 — Generar feedback formativo

Para cada alumno/a, genera exactamente estos 4 bloques:

### 1. Puntos fuertes (1-2 frases)
- Deben ser ESPECÍFICOS de lo que ha hecho este alumno/a, no genéricos
- Malo: "Buen trabajo en general"
- Bueno: "Manejas bien la nomenclatura de compuestos binarios: has acertado cloruro de sodio, hidróxido de calcio y ácido clorhídrico sin dudar"
- Busca algo positivo incluso en exámenes flojos. Siempre hay algo: un planteamiento correcto, una fórmula bien recordada, un intento de razonamiento

### 2. Aspecto principal a mejorar (con ejemplo concreto del examen)
- UN solo aspecto, el más importante. No una lista de 5 cosas
- Incluye el ejemplo exacto de su examen donde se ve el error
- Explica POR QUÉ es un error y cuál sería la forma correcta

### 3. Feedforward (qué hacer para la próxima)
- 2-4 acciones concretas y realizables
- No "estudia más" sino "haz una tabla con los 4 tipos de compuestos y 3 ejemplos de cada uno"
- Que sean cosas que pueda hacer esta semana, no aspiraciones vagas

### 4. Nota orientativa (si aplica)
- Desglose por bloques/preguntas con justificación breve
- Si no tienes baremo, indica que es orientativa

### Tono
- **Profesional cercano** por defecto (salvo que el usuario pida otro)
- Habla al alumno/a de tú
- No uses frases hechas ("sigue así", "buen trabajo", "ánimo")
- Sé directo pero respetuoso. Los adolescentes detectan la falsedad al instante

## Paso 5 — Entregar resultados

Siempre genera los TRES formatos de salida: chat, .docx y fotos anotadas.

### En el chat
Para cada alumno/a, muestra un resumen breve:
- Nombre y grupo
- Nota orientativa
- 1 punto fuerte clave
- 1 aspecto a mejorar clave
- Si hay varios alumnos, usa una tabla resumen al final

### En .docx
Genera UN documento .docx por alumno/a siguiendo el skill `docx`. El documento debe incluir:
- Cabecera con asignatura, curso, nombre del alumno/a
- Corrección detallada por bloques/preguntas
- Los 4 bloques de feedback formativo
- Nota orientativa con desglose
- Pie con mensaje de cierre motivador pero no cursi

Guarda los .docx en la carpeta del workspace del usuario.

Si son muchos alumnos (>5), considera generar también un .docx resumen con la tabla de todos.

### En las propias fotos del examen (anotaciones superpuestas)

Esta es la entrega más valiosa para el docente: devolver las fotos del examen con las correcciones superpuestas, como si las hubiera marcado con bolígrafo rojo y verde. Esto sustituye al marcado manual y ahorra mucho tiempo.

Usa el script `annotate_exam.py`:

```bash
python3 <skill-path>/scripts/annotate_exam.py <imagenes_separadas_por_comas> <json_correcciones> <carpeta_salida>
```

Para ello, genera un JSON de correcciones con esta estructura:

```json
{
    "student_name": "Nombre",
    "student_group": "Grupo",
    "subject": "Asignatura",
    "total_grade": "X / 10",
    "pages": [
        {
            "page_number": 1,
            "annotations": [
                {
                    "y_percent": 35,
                    "type": "correct|incorrect|partial|comment",
                    "text": "Texto de corrección o null si es un simple tick"
                }
            ],
            "page_grade": "X / Y"
        }
    ]
}
```

**Tipos de anotación disponibles:**
- `correct`: tick verde (✓). Para respuestas correctas. No necesita texto.
- `incorrect`: cruz roja (✗) + texto con la corrección. Para errores claros.
- `partial`: tilde naranja (~) + texto con lo que falta o está incompleto.
- `comment`: comentario en azul en el margen. Para explicaciones, trucos o consejos.

**Cómo posicionar las anotaciones:**
- `y_percent` indica la posición vertical como porcentaje de la altura de la imagen (0 = arriba, 100 = abajo)
- Las marcas (✓, ✗, ~) se colocan automáticamente a la derecha de la zona de respuestas
- Los textos de corrección y comentarios van en el margen derecho
- La nota del bloque (`page_grade`) se coloca automáticamente abajo a la derecha
- La nota total (`total_grade`) se coloca arriba a la derecha de la primera página

**Reglas para un buen posicionamiento:**
1. Mira la imagen y estima dónde cae cada respuesta como porcentaje vertical
2. Deja al menos 4-5 puntos de separación entre anotaciones para que no se solapen
3. Los comentarios generales del bloque van en zonas vacías (entre preguntas)
4. Si hay poco espacio, prioriza las correcciones de errores sobre los ticks de respuestas correctas

## Corrección por lotes

Cuando el usuario suba exámenes de varios alumnos a la vez:

1. Agrupa las imágenes por alumno/a (normalmente el nombre aparece en la primera página)
2. Preprocesa todas las imágenes primero
3. Corrige alumno por alumno
4. Al final, presenta una tabla resumen con todos los resultados
5. Genera un .docx individual por alumno/a

Si no puedes identificar a qué alumno pertenece cada imagen, pregunta al usuario.

## Notas sobre el preprocesamiento

El script `preprocess_image.py` hace lo siguiente:
1. Convierte a escala de grises
2. Aumenta contraste con ecualización adaptativa (CLAHE)
3. Aplica enfoque (unsharp mask)
4. Aumenta resolución al doble si es menor de 2000px de ancho
5. Guarda como JPG de alta calidad

Si las imágenes originales son HEIC (iPhone), primero conviértelas a JPG con ImageMagick antes de preprocesar.
