package com.baldissera.home.game

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.min

@Composable
fun MenuScreen(lang: Lang, onToggleLang: () -> Unit, onPlay: (Mode) -> Unit) {
    val texts = lang.texts
    Box(modifier = Modifier.fillMaxSize().background(skyBrush)) {
        Canvas(Modifier.fillMaxSize()) {
            drawSun()
            drawBaseplate(min(size.width, size.height) * 0.22f)
        }

        Text(
            text = lang.flag,
            fontSize = 40.sp,
            modifier = Modifier
                .align(Alignment.TopStart)
                .statusBarsPadding()
                .padding(16.dp)
                .clickable(onClick = onToggleLang)
                .padding(8.dp)
        )

        Column(
            modifier = Modifier.align(Alignment.Center),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(36.dp),
        ) {
            BrickTitle(texts.title)
            BrickButton(BrickColor.RED.color, "🎈 ${texts.freePlay}") { onPlay(Mode.FREE) }
            BrickButton(BrickColor.BLUE.color, "🎨 ${texts.colours}") { onPlay(Mode.COLOURS) }
        }
    }
}

@Composable
private fun BrickTitle(title: String) {
    val palette = BrickColor.entries.map { it.color }
    val text = buildAnnotatedString {
        var i = 0
        title.split(" ").forEachIndexed { line, word ->
            if (line > 0) append("\n")
            word.forEach { ch ->
                withStyle(SpanStyle(color = palette[i++ % palette.size])) { append(ch) }
            }
        }
    }
    Text(
        text = text,
        textAlign = TextAlign.Center,
        style = TextStyle(
            fontSize = 52.sp,
            lineHeight = 58.sp,
            fontWeight = FontWeight.Black,
            shadow = Shadow(Color.White, Offset(4f, 4f), 2f),
        ),
    )
}

@Composable
private fun BrickButton(color: Color, label: String, onClick: () -> Unit) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.clickable(onClick = onClick),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(36.dp)) {
            repeat(4) {
                Box(
                    Modifier
                        .size(width = 38.dp, height = 14.dp)
                        .background(color.darker(0.85f), RoundedCornerShape(topStart = 6.dp, topEnd = 6.dp))
                )
            }
        }
        Box(
            modifier = Modifier
                .size(width = 280.dp, height = 110.dp)
                .background(color, RoundedCornerShape(10.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Text(label, fontSize = 40.sp, fontWeight = FontWeight.ExtraBold, color = Color.White)
        }
    }
}
