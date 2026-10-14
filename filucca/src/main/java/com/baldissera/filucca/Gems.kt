package com.baldissera.filucca

import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.lerp

internal val gemColors = listOf(
    Color(0xFFFF4D6D), // ruby
    Color(0xFFFFB627), // amber
    Color(0xFF38D27A), // emerald
    Color(0xFF3A86FF), // sapphire
    Color(0xFF9D4EDD), // amethyst
    Color(0xFF00D4FF), // aqua
    Color(0xFFFF70A6), // rose
)

internal val gemBackground = Brush.verticalGradient(
    listOf(Color(0xFF1B1446), Color(0xFF3A1C71), Color(0xFF5B2A86))
)

internal fun Color.lighter(f: Float) = lerp(this, Color.White, f)

/** A bevelled, shiny gem block filling cell [c] at [topLeft]; [scale] shrinks it around its centre. */
internal fun DrawScope.drawGemCell(topLeft: Offset, c: Float, color: Color, alpha: Float = 1f, scale: Float = 1f) {
    val s = c * scale
    val w = s * 0.92f
    val x = topLeft.x + (c - w) / 2f
    val y = topLeft.y + (c - w) / 2f
    drawRoundRect(
        Brush.verticalGradient(listOf(color.lighter(0.3f), color, color.darker(0.65f)), startY = y, endY = y + w),
        Offset(x, y), Size(w, w), CornerRadius(w * 0.2f), alpha = alpha,
    )
    val f = w * 0.15f
    drawRoundRect(
        Brush.verticalGradient(listOf(color.lighter(0.4f), color.lighter(0.08f)), startY = y + f, endY = y + w - f),
        Offset(x + f, y + f), Size(w - 2 * f, w - 2 * f), CornerRadius(w * 0.12f), alpha = alpha,
    )
    drawOval(Color.White.copy(alpha = 0.5f * alpha), Offset(x + w * 0.2f, y + w * 0.17f), Size(w * 0.36f, w * 0.15f))
}
