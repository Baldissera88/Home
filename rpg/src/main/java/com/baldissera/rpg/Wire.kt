package com.baldissera.rpg

import android.os.SystemClock
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Compact JSON describing the game for the 3D renderer: the level once, then the moving state every frame.
 * Positions are in tiles (x right, y down the map). Entities are positional arrays to keep frames small;
 * web/js/wire.js documents and reads the same layout.
 */
object Wire {
    private fun StringBuilder.n(v: Float): StringBuilder {
        if (v.isNaN() || v.isInfinite()) return append('0')
        val r = (v * 100f).roundToInt()
        if (r < 0) append('-')
        val a = abs(r)
        append(a / 100)
        val frac = a % 100
        if (frac != 0) {
            append('.')
            when {
                frac < 10 -> append('0').append(frac)
                frac % 10 == 0 -> append(frac / 10)
                else -> append(frac)
            }
        }
        return this
    }

    /** [v] in fixed point with [scale] = 10^decimals, trailing zeros dropped; no allocation. */
    private fun StringBuilder.fixed(v: Float, scale: Long): StringBuilder {
        if (v.isNaN() || v.isInfinite()) return append('0')
        val r = Math.round(v.toDouble().coerceIn(-1e12, 1e12) * scale)
        if (r < 0L) append('-')
        val a = abs(r)
        append(a / scale)
        var frac = a % scale
        if (frac != 0L) {
            append('.')
            var lim = scale / 10L
            while (frac % 10L == 0L) {
                frac /= 10L
                lim /= 10L
            }
            while (frac < lim) {
                append('0')
                lim /= 10L
            }
            append(frac)
        }
        return this
    }

    private fun StringBuilder.n3(v: Float): StringBuilder = fixed(v, 1000L)

    private fun StringBuilder.n4(v: Float): StringBuilder = fixed(v, 10000L)

    /** [text] escaped for a JSON string, without the quotes. */
    private fun StringBuilder.esc(text: String): StringBuilder {
        for (i in text.indices) {
            val c = text[i]
            when {
                c == '"' -> append("\\\"")
                c == '\\' -> append("\\\\")
                c == '\n' -> append("\\n")
                c < ' ' -> append(' ')
                else -> append(c)
            }
        }
        return this
    }

    private fun StringBuilder.s(text: String): StringBuilder = append('"').esc(text).append('"')

    private fun Boolean.b() = if (this) 1 else 0

    private fun argb(c: Color): Long = c.toArgb().toLong() and 0xFFFFFFFFL

    /** Everything that does not move: tiles, ground materials, props, buildings and lights. */
    fun level(g: Game): String {
        val d = g.dungeon
        val m = TerrainMap(d)
        val sb = StringBuilder(d.w * d.h * 6 + 4096)
        sb.append("{\"k\":\"level\",\"biome\":\"").append(d.biome.name).append("\",\"floor\":").append(g.floor)
        sb.append(",\"w\":").append(d.w).append(",\"h\":").append(d.h).append(",\"seed\":").append(m.signature)
        sb.append(",\"tiles\":\"")
        for (t in d.tiles) sb.append(('0' + t))
        sb.append("\",\"mat\":\"")
        for (b in m.mat) sb.append(('0' + b.toInt()))
        sb.append("\",\"var\":\"")
        for (v in d.variant) {
            val q = (v * 255f).toInt().coerceIn(0, 255)
            sb.append(HEX[q ushr 4]).append(HEX[q and 15])
        }
        sb.append("\",\"props\":[")
        d.props.forEachIndexed { i, p ->
            if (i > 0) sb.append(',')
            sb.append('[').append(p.type.ordinal).append(',').n(p.x).append(',').n(p.y).append(',').append(p.used.b()).append(']')
        }
        sb.append("],\"bld\":[")
        d.buildings.forEachIndexed { i, b ->
            if (i > 0) sb.append(',')
            sb.append('[').append(b.sprite).append(',').append(b.x).append(',').append(b.y).append(',').append(b.w).append(',').append(b.h)
                .append(',').append(b.light).append(',').n(b.lightX).append(',').n(b.lightY).append(']')
        }
        sb.append("],\"ent\":[")
        d.entrances.forEachIndexed { i, e ->
            if (i > 0) sb.append(',')
            sb.append('[').append(e.x).append(',').append(e.y).append(',').append(e.region.ordinal).append(',').append((g.questStage >= e.region.quest).b()).append(']')
        }
        sb.append("],\"torch\":[")
        d.torches.forEachIndexed { i, t -> if (i > 0) sb.append(','); sb.append(t) }
        sb.append("],\"exit\":[").append(d.exit.cx).append(',').append(d.exit.cy).append(']')
        d.village?.let { sb.append(",\"vil\":[").append(it.x).append(',').append(it.y).append(',').append(it.w).append(',').append(it.h).append(']') }
        if (d.hasMerchant) sb.append(",\"mer\":[").n(g.merchantX).append(',').n(g.merchantY).append(']')
        return sb.append('}').toString()
    }

    /** Hero action: 0 idle, 1 run, 2 attack, 3 cast, 4 dodge, 5 hurt, 6 dead, 7 whirlwind, 8 leap, 9 charge, 10 sweep. */
    private fun action(g: Game): Int {
        val p = g.player
        return when {
            g.dead -> 6
            p.leap > 0f -> 8
            p.charge > 0f -> 9
            p.spin > 0f -> 7
            p.whirl > 0f -> 10
            p.dodge > 0f -> 4
            p.cast > 0f -> 3
            p.swing > 0f -> 2
            p.hurt > 0.2f -> 5
            p.moving -> 1
            else -> 0
        }
    }

    /** Reused by [frame], which runs every display frame on the main thread. */
    private val frameSb = StringBuilder(16384)
    private var frameSeq = 0
    private const val MAX_PARTICLES = 350

    /**
     * The moving world for one frame; [yaw] is where the camera looks, in radians. "t" carries 4 decimals,
     * positions, facings and the camera 3; "fs" counts frames and "ts" is the send time (uptime ms), both for
     * web/js/interp.js. Only the newest [MAX_PARTICLES] particles are sent.
     */
    @Synchronized
    fun frame(g: Game, yaw: Float): String {
        val p = g.player
        val d = g.dungeon
        val sb = frameSb
        sb.setLength(0)
        frameSeq++
        sb.append("{\"k\":\"f\",\"t\":").n4(g.time).append(",\"fs\":").append(frameSeq).append(",\"ts\":").append(SystemClock.uptimeMillis())
            .append(",\"dl\":").n(g.daylight).append(",\"rn\":").n(g.rain)
            .append(",\"fg\":").n(g.fogAmount).append(",\"fd\":").n(g.fade).append(",\"cy\":").n3(yaw)
            .append(",\"sh\":[").n(g.shakeX).append(',').n(g.shakeY).append("],\"lf\":").n(g.levelFlash)
            .append(",\"hs\":").append(if (g.hitStopping) 1 else 0)
        var flags = 0
        if (p.stealth > 0f) flags = flags or 1
        if (p.holy > 0f) flags = flags or 2
        if (p.fury > 0f) flags = flags or 4
        if (p.venom > 0f) flags = flags or 8
        if (p.chill > 0f) flags = flags or 16
        if (p.hurt > 0f) flags = flags or 32
        sb.append(",\"p\":[").n3(p.x).append(',').n3(p.y).append(',').n3(p.faceX).append(',').n3(p.faceY).append(',').append(action(g))
            .append(',').n(p.swing).append(',').n(p.swingTime).append(',').append(p.heroClass.ordinal).append(',').append(p.weaponKind.ordinal)
            .append(',').n(p.hp / p.maxHp).append(',').append(flags).append(',').n3(p.leapZ).append(',').append(p.buff?.ordinal ?: -1)
            .append(',').n(hypot2(p.vx, p.vy)).append(']')

        sb.append(",\"e\":[")
        val enemies = g.enemies
        for (i in enemies.indices) {
            val e = enemies[i]
            if (i > 0) sb.append(',')
            var f = 0
            if (e.frozen > 0f) f = f or 1
            if (e.poison > 0f) f = f or 2
            if (e.stun > 0f) f = f or 4
            if (e.shield > 0f) f = f or 8
            if (e.elite) f = f or 16
            if (e.type.boss) f = f or 32
            if (e.aggro) f = f or 64
            if (e.fear > 0f) f = f or 128
            val wind = if (e.windup > 0f) 1f - e.windup / e.type.windup else 0f
            sb.append('[').append(e.uid).append(',').append(e.type.ordinal).append(',').n3(e.x).append(',').n3(e.y).append(',').n3(e.faceX).append(',').n3(e.faceY)
                .append(',').append(e.moving.b()).append(',').n(wind).append(',').n(e.flash).append(',').append(f).append(',').n(e.size)
                .append(',').n(e.hp / e.maxHp).append(',').append('"')
            if (e.elite || e.type.boss) {
                sb.esc(e.name)
                val affixes = e.affixes
                if (affixes.isNotEmpty()) {
                    sb.append('|')
                    for (j in affixes.indices) {
                        if (j > 0) sb.append(" · ")
                        sb.esc(affixes[j].label)
                    }
                }
            }
            sb.append("\"]")
        }
        sb.append("],\"n\":[")
        val npcs = d.npcs
        for (i in npcs.indices) {
            val n = npcs[i]
            if (i > 0) sb.append(',')
            sb.append('[').append(n.uid).append(',').append(n.kind.ordinal).append(',').n3(n.x).append(',').n3(n.y).append(',').n3(n.faceX).append(',').n3(n.faceY)
                .append(',').append(n.moving.b()).append(',').s(n.say ?: "").append(']')
        }
        sb.append("],\"pr\":[")
        val shots = g.projectiles
        for (i in shots.indices) {
            val pr = shots[i]
            if (i > 0) sb.append(',')
            val f = pr.small.b() or (pr.hostile.b() shl 1) or ((pr.aoe > 0f).b() shl 2)
            sb.append('[').n3(pr.x).append(',').n3(pr.y).append(',').n(pr.vx).append(',').n(pr.vy).append(',').append(argb(pr.color)).append(',').n(pr.radius).append(',').append(f).append(']')
        }
        sb.append("],\"lo\":[")
        val loot = g.loot
        for (i in loot.indices) {
            val l = loot[i]
            if (i > 0) sb.append(',')
            sb.append('[').append(l.uid).append(',')
            when (val k = l.kind) {
                is LootKind.Gold -> sb.append("0,").n3(l.x).append(',').n3(l.y).append(',').n3(l.z).append(",0,0,\"").append(k.amount).append(" gold\"")
                LootKind.Potion -> sb.append("1,").n3(l.x).append(',').n3(l.y).append(',').n3(l.z).append(",0,0,\"\"")
                is LootKind.Gear -> sb.append("2,").n3(l.x).append(',').n3(l.y).append(',').n3(l.z).append(',').append(k.item.rarity.ordinal).append(',').append(k.item.icon).append(',').s(k.item.name)
                is LootKind.Shard -> sb.append("3,").n3(l.x).append(',').n3(l.y).append(',').n3(l.z).append(",0,0,\"\"")
            }
            sb.append(']')
        }
        sb.append("],\"pa\":[")
        val parts = g.particles
        val firstPart = if (parts.size > MAX_PARTICLES) parts.size - MAX_PARTICLES else 0
        for (i in firstPart until parts.size) {
            val pt = parts[i]
            if (i > firstPart) sb.append(',')
            val f = pt.glow.b() or (pt.soft.b() shl 1)
            sb.n(pt.x).append(',').n(pt.y).append(',').n(pt.z).append(',').n(pt.size).append(',').append(argb(pt.color)).append(',').n(1f - pt.age / pt.life).append(',').append(f)
        }
        sb.append("],\"tx\":[")
        val texts = g.texts
        for (i in texts.indices) {
            val t = texts[i]
            if (i > 0) sb.append(',')
            // Then where it appeared, about a tile below its 2D starting point: the speaker it belongs to.
            sb.append('[').n(t.x).append(',').n(t.y).append(',').s(t.text).append(',').append(argb(t.color)).append(',').append(t.big.b()).append(',').n(t.age)
                .append(',').n(t.ox).append(',').n(t.oy + 1f).append(']')
        }
        sb.append("],\"zo\":[")
        val zones = g.zones
        for (i in zones.indices) {
            val z = zones[i]
            if (i > 0) sb.append(',')
            sb.append('[').n(z.x).append(',').n(z.y).append(',').n(z.radius).append(',').append(z.kind.ordinal).append(',').n(z.age / z.life).append(']')
        }
        sb.append("],\"me\":[")
        val meteors = g.meteors
        for (i in meteors.indices) {
            val m = meteors[i]
            if (i > 0) sb.append(',')
            sb.append('[').n(m.x).append(',').n(m.y).append(',').n(m.t).append(']')
        }
        sb.append("],\"bo\":[")
        val bolts = g.bolts
        for (i in bolts.indices) {
            val b = bolts[i]
            if (i > 0) sb.append(',')
            sb.append('[').n(b.x1).append(',').n(b.y1).append(',').n(b.x2).append(',').n(b.y2).append(',').n(b.age).append(',').append(b.seed).append(']')
        }
        sb.append("],\"wa\":[")
        val waves = g.waves
        for (i in waves.indices) {
            val w = waves[i]
            if (i > 0) sb.append(',')
            sb.append('[').n(w.x).append(',').n(w.y).append(',').n(w.radius).append(',').append(argb(w.color)).append(',').n(w.age / w.life).append(']')
        }
        sb.append("],\"dc\":[")
        val decals = g.decals
        for (i in decals.indices) {
            val dc = decals[i]
            if (i > 0) sb.append(',')
            sb.append('[').n(dc.x).append(',').n(dc.y).append(',').append(dc.kind).append(',').n(dc.rotation).append(',').n(dc.scale).append(']')
        }
        sb.append("],\"gh\":[")
        val ghosts = g.ghosts
        for (i in ghosts.indices) {
            val gh = ghosts[i]
            if (i > 0) sb.append(',')
            sb.append('[').n(gh.x).append(',').n(gh.y).append(',').n(gh.age).append(']')
        }
        sb.append("],\"pu\":\"")
        val props = d.props
        for (i in props.indices) sb.append(if (props[i].used) '1' else '0')
        sb.append("\"}")
        return sb.toString()
    }

    private fun hypot2(a: Float, b: Float) = kotlin.math.sqrt(a * a + b * b)

    private val HEX = "0123456789abcdef".toCharArray()
}
