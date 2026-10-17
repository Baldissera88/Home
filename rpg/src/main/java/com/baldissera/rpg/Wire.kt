package com.baldissera.rpg

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

    private fun StringBuilder.s(text: String): StringBuilder {
        append('"')
        for (c in text) {
            when {
                c == '"' -> append("\\\"")
                c == '\\' -> append("\\\\")
                c == '\n' -> append("\\n")
                c < ' ' -> append(' ')
                else -> append(c)
            }
        }
        return append('"')
    }

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

    /** The moving world for one frame; [yaw] is where the camera looks, in radians. */
    fun frame(g: Game, yaw: Float): String {
        val p = g.player
        val d = g.dungeon
        val sb = StringBuilder(8192)
        sb.append("{\"k\":\"f\",\"t\":").n(g.time).append(",\"dl\":").n(g.daylight).append(",\"rn\":").n(g.rain)
            .append(",\"fg\":").n(g.fogAmount).append(",\"fd\":").n(g.fade).append(",\"cy\":").n(yaw)
            .append(",\"sh\":[").n(g.shakeX).append(',').n(g.shakeY).append("],\"lf\":").n(g.levelFlash)
        var flags = 0
        if (p.stealth > 0f) flags = flags or 1
        if (p.holy > 0f) flags = flags or 2
        if (p.fury > 0f) flags = flags or 4
        if (p.venom > 0f) flags = flags or 8
        if (p.chill > 0f) flags = flags or 16
        if (p.hurt > 0f) flags = flags or 32
        sb.append(",\"p\":[").n(p.x).append(',').n(p.y).append(',').n(p.faceX).append(',').n(p.faceY).append(',').append(action(g))
            .append(',').n(p.swing).append(',').n(p.swingTime).append(',').append(p.heroClass.ordinal).append(',').append(p.weaponKind.ordinal)
            .append(',').n(p.hp / p.maxHp).append(',').append(flags).append(',').n(p.leapZ).append(',').append(p.buff?.ordinal ?: -1)
            .append(',').n(hypot2(p.vx, p.vy)).append(']')

        sb.append(",\"e\":[")
        g.enemies.forEachIndexed { i, e ->
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
            sb.append('[').append(e.uid).append(',').append(e.type.ordinal).append(',').n(e.x).append(',').n(e.y).append(',').n(e.faceX).append(',').n(e.faceY)
                .append(',').append(e.moving.b()).append(',').n(wind).append(',').n(e.flash).append(',').append(f).append(',').n(e.size)
                .append(',').n(e.hp / e.maxHp).append(',')
            if (e.elite || e.type.boss) sb.s(e.name + if (e.affixes.isNotEmpty()) "|" + e.affixText else "") else sb.append("\"\"")
            sb.append(']')
        }
        sb.append("],\"n\":[")
        d.npcs.forEachIndexed { i, n ->
            if (i > 0) sb.append(',')
            sb.append('[').append(n.uid).append(',').append(n.kind.ordinal).append(',').n(n.x).append(',').n(n.y).append(',').n(n.faceX).append(',').n(n.faceY)
                .append(',').append(n.moving.b()).append(',').s(n.say ?: "").append(']')
        }
        sb.append("],\"pr\":[")
        g.projectiles.forEachIndexed { i, pr ->
            if (i > 0) sb.append(',')
            val f = pr.small.b() or (pr.hostile.b() shl 1) or ((pr.aoe > 0f).b() shl 2)
            sb.append('[').n(pr.x).append(',').n(pr.y).append(',').n(pr.vx).append(',').n(pr.vy).append(',').append(argb(pr.color)).append(',').n(pr.radius).append(',').append(f).append(']')
        }
        sb.append("],\"lo\":[")
        g.loot.forEachIndexed { i, l ->
            if (i > 0) sb.append(',')
            sb.append('[').append(l.uid).append(',')
            when (val k = l.kind) {
                is LootKind.Gold -> sb.append("0,").n(l.x).append(',').n(l.y).append(',').n(l.z).append(",0,0,").s("${k.amount} gold")
                LootKind.Potion -> sb.append("1,").n(l.x).append(',').n(l.y).append(',').n(l.z).append(",0,0,\"\"")
                is LootKind.Gear -> sb.append("2,").n(l.x).append(',').n(l.y).append(',').n(l.z).append(',').append(k.item.rarity.ordinal).append(',').append(k.item.icon).append(',').s(k.item.name)
                is LootKind.Shard -> sb.append("3,").n(l.x).append(',').n(l.y).append(',').n(l.z).append(",0,0,\"\"")
            }
            sb.append(']')
        }
        sb.append("],\"pa\":[")
        var first = true
        for (pt in g.particles) {
            if (!first) sb.append(',')
            first = false
            val f = pt.glow.b() or (pt.soft.b() shl 1)
            sb.n(pt.x).append(',').n(pt.y).append(',').n(pt.z).append(',').n(pt.size).append(',').append(argb(pt.color)).append(',').n(1f - pt.age / pt.life).append(',').append(f)
        }
        sb.append("],\"tx\":[")
        g.texts.forEachIndexed { i, t ->
            if (i > 0) sb.append(',')
            sb.append('[').n(t.x).append(',').n(t.y).append(',').s(t.text).append(',').append(argb(t.color)).append(',').append(t.big.b()).append(',').n(t.age).append(']')
        }
        sb.append("],\"zo\":[")
        g.zones.forEachIndexed { i, z ->
            if (i > 0) sb.append(',')
            sb.append('[').n(z.x).append(',').n(z.y).append(',').n(z.radius).append(',').append(z.kind.ordinal).append(',').n(z.age / z.life).append(']')
        }
        sb.append("],\"me\":[")
        g.meteors.forEachIndexed { i, m -> if (i > 0) sb.append(','); sb.append('[').n(m.x).append(',').n(m.y).append(',').n(m.t).append(']') }
        sb.append("],\"bo\":[")
        g.bolts.forEachIndexed { i, b -> if (i > 0) sb.append(','); sb.append('[').n(b.x1).append(',').n(b.y1).append(',').n(b.x2).append(',').n(b.y2).append(',').n(b.age).append(',').append(b.seed).append(']') }
        sb.append("],\"wa\":[")
        g.waves.forEachIndexed { i, w -> if (i > 0) sb.append(','); sb.append('[').n(w.x).append(',').n(w.y).append(',').n(w.radius).append(',').append(argb(w.color)).append(',').n(w.age / w.life).append(']') }
        sb.append("],\"dc\":[")
        g.decals.forEachIndexed { i, dc -> if (i > 0) sb.append(','); sb.append('[').n(dc.x).append(',').n(dc.y).append(',').append(dc.kind).append(',').n(dc.rotation).append(',').n(dc.scale).append(']') }
        sb.append("],\"gh\":[")
        g.ghosts.forEachIndexed { i, gh -> if (i > 0) sb.append(','); sb.append('[').n(gh.x).append(',').n(gh.y).append(',').n(gh.age).append(']') }
        sb.append("],\"pu\":\"")
        for (pr in d.props) sb.append(if (pr.used) '1' else '0')
        sb.append("\"}")
        return sb.toString()
    }

    private fun hypot2(a: Float, b: Float) = kotlin.math.sqrt(a * a + b * b)

    private val HEX = "0123456789abcdef".toCharArray()
}
