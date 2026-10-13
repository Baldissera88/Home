package com.baldissera.home.game

import androidx.compose.ui.graphics.Color
import java.util.Locale

enum class BrickColor(val color: Color, val en: String, val da: String, val daPlural: String) {
    RED(Color(0xFFD01012), "red", "rød", "røde"),
    BLUE(Color(0xFF0055BF), "blue", "blå", "blå"),
    YELLOW(Color(0xFFF2CD37), "yellow", "gul", "gule"),
    GREEN(Color(0xFF237841), "green", "grøn", "grønne"),
    ORANGE(Color(0xFFFE8A18), "orange", "orange", "orange"),
    PURPLE(Color(0xFF8E44AD), "purple", "lilla", "lilla"),
}

interface Texts {
    val title: String
    val freePlay: String
    val colours: String
    val intro: String
    val cheers: List<String>
    fun find(c: BrickColor): String
    fun nowFind(c: BrickColor): String
    fun thatIs(c: BrickColor): String
}

object EnglishTexts : Texts {
    override val title = "Victor's Bricks"
    override val freePlay = "Pop!"
    override val colours = "Colours"
    override val intro = "Pop the bricks, Victor!"
    override val cheers = listOf(
        "Great job, Victor!", "Awesome, Victor!", "Super, Victor!", "Wow, Victor!", "You rock, Victor!",
    )
    override fun find(c: BrickColor) = "Pop the ${c.en} bricks, Victor!"
    override fun nowFind(c: BrickColor) = "Now find the ${c.en} ones!"
    override fun thatIs(c: BrickColor) = "That one is ${c.en}!"
}

object DanishTexts : Texts {
    override val title = "Victors Klodser"
    override val freePlay = "Pop!"
    override val colours = "Farver"
    override val intro = "Pop klodserne, Victor!"
    override val cheers = listOf(
        "Godt gået, Victor!", "Fantastisk, Victor!", "Super, Victor!", "Wow, Victor!", "Du er sej, Victor!",
    )
    override fun find(c: BrickColor) = "Pop de ${c.daPlural} klodser, Victor!"
    override fun nowFind(c: BrickColor) = "Find nu de ${c.daPlural}!"
    override fun thatIs(c: BrickColor) = "Den er ${c.da}!"
}

enum class Lang(val locale: Locale, val flag: String, val texts: Texts) {
    DA(Locale.forLanguageTag("da-DK"), "🇩🇰", DanishTexts),
    EN(Locale.UK, "🇬🇧", EnglishTexts);

    fun next(): Lang = entries[(ordinal + 1) % entries.size]
}
