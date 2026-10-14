package com.baldissera.filucca

import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope

internal val pieceColors = listOf(
    Color(0xFF00A3DA), // light blue
    Color(0xFFF2CD37), // yellow
    Color(0xFF8E44AD), // purple
    Color(0xFF4B9F4A), // green
    Color(0xFFD01012), // red
    Color(0xFF0055BF), // blue
    Color(0xFFFE8A18), // orange
)

internal fun Color.darker(f: Float) = Color(red * f, green * f, blue * f, alpha)

/** One square brick with a stud on top. */
internal fun DrawScope.drawStudCell(topLeft: Offset, c: Float, color: Color, alpha: Float = 1f) {
    val inset = c * 0.04f
    drawRoundRect(
        color.copy(alpha = alpha),
        Offset(topLeft.x + inset, topLeft.y + inset),
        Size(c - 2 * inset, c - 2 * inset),
        CornerRadius(c * 0.12f),
    )
    drawRoundRect(
        color.darker(0.75f).copy(alpha = alpha),
        Offset(topLeft.x + inset, topLeft.y + c * 0.78f),
        Size(c - 2 * inset, c * 0.18f),
        CornerRadius(c * 0.08f),
    )
    drawCircle(color.darker(0.88f).copy(alpha = alpha), radius = c * 0.27f, center = Offset(topLeft.x + c / 2f, topLeft.y + c * 0.45f))
    drawCircle(Color.White.copy(alpha = 0.3f * alpha), radius = c * 0.11f, center = Offset(topLeft.x + c * 0.4f, topLeft.y + c * 0.36f))
}
