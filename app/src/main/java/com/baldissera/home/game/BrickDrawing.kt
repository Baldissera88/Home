package com.baldissera.home.game

import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.drawText

fun Color.darker(f: Float = 0.75f) = Color(red * f, green * f, blue * f, alpha)

/** A 2x2 toy brick centred on [center], [s] wide, with an optional face printed on the front. */
fun DrawScope.drawBrick(center: Offset, s: Float, color: Color, face: TextLayoutResult? = null) {
    val bodyH = s * 0.72f
    val left = center.x - s / 2f
    val top = center.y - bodyH / 2f
    val studW = s * 0.26f
    val studH = s * 0.13f
    for (dx in listOf(-0.24f, 0.24f)) {
        val studLeft = center.x + dx * s - studW / 2f
        drawRoundRect(color.darker(0.85f), Offset(studLeft, top - studH + 2f), Size(studW, studH), CornerRadius(s * 0.04f))
        drawRoundRect(Color.White.copy(alpha = 0.35f), Offset(studLeft + studW * 0.15f, top - studH + 4f), Size(studW * 0.25f, studH * 0.6f), CornerRadius(s * 0.03f))
    }
    drawRoundRect(color, Offset(left, top), Size(s, bodyH), CornerRadius(s * 0.06f))
    drawRoundRect(color.darker(), Offset(left, top + bodyH * 0.82f), Size(s, bodyH * 0.18f), CornerRadius(s * 0.06f))
    drawRect(Color.White.copy(alpha = 0.25f), Offset(left + s * 0.05f, top + s * 0.03f), Size(s * 0.9f, s * 0.035f))
    if (face != null) {
        drawText(
            face,
            topLeft = Offset(center.x - face.size.width / 2f, center.y - face.size.height / 2f - bodyH * 0.04f),
        )
    }
}

fun DrawScope.drawSun() {
    val r = size.minDimension * 0.12f
    val center = Offset(size.width - r * 1.4f, r * 2.2f)
    drawCircle(Color(0x55FFEB3B), radius = r * 1.5f, center = center)
    drawCircle(Color(0xFFFFEB3B), radius = r, center = center)
}

/** Green baseplate along the bottom edge; bricks rise up from behind it. */
fun DrawScope.drawBaseplate(s: Float) {
    val green = Color(0xFF4B9F4A)
    val plateH = s * 0.35f
    val top = size.height - plateH
    val studW = s * 0.2f
    val studH = s * 0.09f
    var x = studW * 0.4f
    while (x < size.width) {
        drawRoundRect(green.darker(0.9f), Offset(x, top - studH + 2f), Size(studW, studH), CornerRadius(studW * 0.15f))
        x += studW * 1.6f
    }
    drawRect(green, Offset(0f, top), Size(size.width, plateH))
    drawRect(green.darker(), Offset(0f, top + plateH * 0.75f), Size(size.width, plateH * 0.25f))
}
