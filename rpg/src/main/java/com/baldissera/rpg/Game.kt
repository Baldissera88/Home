package com.baldissera.rpg

import android.content.SharedPreferences
import androidx.compose.ui.graphics.Color
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.random.Random

val GOLD = Color(0xFFFFC94D)
private val XP_COLOR = Color(0xFFB388FF)
private val HURT_COLOR = Color(0xFFFF5252)
private val FIRE = Color(0xFFFF7A1A)

private val weaponBases = listOf("Sværd", "Økse", "Stridshammer", "Dolk", "Morgenstjerne", "Spyd")
private val armorBases = listOf("Læderbrynje", "Ringbrynje", "Pladerustning", "Skælbrynje")
private val ringBases = listOf("Ring", "Signetring", "Runering")
private val prefixes = listOf("Dragens", "Skyggernes", "Kongens", "Ulvens", "Stormens", "Blodets", "Ravnens", "Isens", "Ildens")
private val legendaryNames = mapOf(
    Slot.WEAPON to listOf("Mjølner", "Gram", "Tyrfing", "Dainsleif"),
    Slot.ARMOR to listOf("Odins Kappe", "Ymers Hud"),
    Slot.RING to listOf("Draupner", "Andvaranaut"),
)

class Game(private val sfx: Sfx, private val prefs: SharedPreferences) {
    private val rnd = Random(System.nanoTime())

    var dungeon: Dungeon = Dungeon.generate(rnd)
        private set
    val player = Player()
    val enemies = mutableListOf<Enemy>()
    val projectiles = mutableListOf<Projectile>()
    val loot = mutableListOf<Loot>()
    val texts = mutableListOf<FloatText>()
    val particles = mutableListOf<Particle>()
    var explored = BooleanArray(dungeon.w * dungeon.h)
        private set
    var floor = 1
        private set
    var time = 0f
        private set
    var shake = 0f
        private set
    var shakeX = 0f
        private set
    var shakeY = 0f
        private set
    var message: String? = null
        private set
    var messageColor = Color.White
        private set
    var messageTimer = 0f
        private set
    var dead = false
        private set
    var levelFlash = 0f
        private set

    /** Joystick direction, each axis -1..1. */
    var joyX = 0f
    var joyY = 0f
    var attackHeld = false

    val boss: Enemy? get() = enemies.firstOrNull { it.type == EnemyType.BOSS }

    init {
        load()
        enterFloor()
    }

    // ---------- floors & saving ----------

    private fun enterFloor() {
        dungeon = Dungeon.generate(rnd)
        explored = BooleanArray(dungeon.w * dungeon.h)
        enemies.clear()
        projectiles.clear()
        loot.clear()
        texts.clear()
        particles.clear()
        player.x = dungeon.start.cx + 0.5f
        player.y = dungeon.start.cy + 0.5f
        player.hp = player.hp.coerceIn(1f, player.maxHp)

        for (room in dungeon.rooms) {
            if (room === dungeon.start) continue
            repeat(rnd.nextInt(2, 5) + floor / 3) {
                val ex = room.x + 0.5f + rnd.nextInt(room.w)
                val ey = room.y + 0.5f + rnd.nextInt(room.h)
                enemies += Enemy(randomType(), ex, ey, floor)
            }
        }
        if (floor % 3 == 0) {
            enemies += Enemy(EnemyType.BOSS, dungeon.exit.cx + 0.5f, dungeon.exit.cy - 0.5f, floor)
            showMessage("Dybde $floor — noget ondt venter…", HURT_COLOR)
        } else {
            showMessage("Dybde $floor", Color.White)
        }
        save()
    }

    private fun randomType(): EnemyType {
        val pool = buildList {
            add(EnemyType.SLIME); add(EnemyType.BAT); add(EnemyType.SKELETON); add(EnemyType.SKELETON)
            if (floor >= 2) add(EnemyType.BRUTE)
            if (floor >= 4) { add(EnemyType.BRUTE); add(EnemyType.SKELETON) }
        }
        return pool.random(rnd)
    }

    fun save() {
        prefs.edit()
            .putBoolean("exists", true)
            .putInt("level", player.level)
            .putInt("xp", player.xp)
            .putInt("gold", player.gold)
            .putInt("potions", player.potions)
            .putInt("floor", floor)
            .putString("weapon", player.weapon?.serialize())
            .putString("armor", player.armor?.serialize())
            .putString("ring", player.ring?.serialize())
            .apply()
    }

    private fun load() {
        player.level = prefs.getInt("level", 1)
        player.xp = prefs.getInt("xp", 0)
        player.gold = prefs.getInt("gold", 0)
        player.potions = prefs.getInt("potions", 3)
        floor = prefs.getInt("floor", 1)
        player.weapon = Item.parse(prefs.getString("weapon", null))
        player.armor = Item.parse(prefs.getString("armor", null))
        player.ring = Item.parse(prefs.getString("ring", null))
        player.hp = player.maxHp
        player.mana = player.maxMana
    }

    val hasSave: Boolean get() = prefs.getBoolean("exists", false)

    fun newGame() {
        prefs.edit().clear().apply()
        player.level = 1
        player.xp = 0
        player.gold = 0
        player.potions = 3
        player.weapon = null
        player.armor = null
        player.ring = null
        player.hp = player.maxHp
        player.mana = player.maxMana
        floor = 1
        dead = false
        enterFloor()
    }

    fun respawn() {
        val lost = player.gold / 5
        player.gold -= lost
        player.hp = player.maxHp
        player.mana = player.maxMana
        dead = false
        enterFloor()
        showMessage("Du rejser dig igen… (−$lost guld)", GOLD)
    }

    private fun showMessage(text: String, color: Color) {
        message = text
        messageColor = color
        messageTimer = 2.8f
    }

    // ---------- main update ----------

    fun update(dt: Float) {
        time += dt
        if (messageTimer > 0f) {
            messageTimer -= dt
            if (messageTimer <= 0f) message = null
        }
        shake = max(0f, shake - dt * 2.5f)
        shakeX = if (shake > 0f) (rnd.nextFloat() - 0.5f) * shake * 0.3f else 0f
        shakeY = if (shake > 0f) (rnd.nextFloat() - 0.5f) * shake * 0.3f else 0f
        levelFlash = max(0f, levelFlash - dt)
        updateParticles(dt)
        updateTexts(dt)
        if (dead) return
        updatePlayer(dt)
        updateEnemies(dt)
        updateProjectiles(dt)
        updateLoot()
        reveal()
    }

    private fun blocked(x: Float, y: Float, r: Float) =
        !dungeon.walkableAt(x - r, y - r) || !dungeon.walkableAt(x + r, y - r) ||
            !dungeon.walkableAt(x - r, y + r) || !dungeon.walkableAt(x + r, y + r)

    private fun move(b: Body, dx: Float, dy: Float, r: Float) {
        if (!blocked(b.x + dx, b.y, r)) b.x += dx
        if (!blocked(b.x, b.y + dy, r)) b.y += dy
    }

    private fun updatePlayer(dt: Float) {
        val p = player
        p.attackCd -= dt
        p.swing = max(0f, p.swing - dt)
        p.whirl = max(0f, p.whirl - dt)
        p.hurt = max(0f, p.hurt - dt)
        p.sinceHurt += dt
        p.mana = min(p.maxMana, p.mana + 5f * dt)
        if (p.sinceHurt > 4f) p.hp = min(p.maxHp, p.hp + p.maxHp * 0.01f * dt)

        val len = hypot(joyX, joyY)
        p.moving = len > 0.15f
        if (p.moving) {
            val speed = 3.4f * min(1f, len)
            val nx = joyX / len
            val ny = joyY / len
            if (p.swing <= 0f && p.whirl <= 0f) {
                p.faceX = nx
                p.faceY = ny
            }
            move(p, nx * speed * dt, ny * speed * dt, 0.3f)
            p.walk += dt * speed * 3f
        }

        if (attackHeld && p.attackCd <= 0f) attack()

        if (dungeon.tile(floorInt(p.x), floorInt(p.y)) == STAIRS) {
            if (boss != null) {
                if (messageTimer <= 0f) showMessage("Besejr Dæmonherren først!", HURT_COLOR)
            } else {
                floor++
                sfx.stairs()
                enterFloor()
            }
        }
    }

    private fun dist(e: Enemy) = hypot(e.x - player.x, e.y - player.y)

    private fun nearestEnemy(range: Float): Enemy? = enemies.filter { dist(it) < range }.minByOrNull { dist(it) }

    private fun faceToward(e: Enemy) {
        val d = dist(e).coerceAtLeast(0.001f)
        player.faceX = (e.x - player.x) / d
        player.faceY = (e.y - player.y) / d
    }

    // ---------- player actions ----------

    fun attack() {
        val p = player
        if (dead || p.attackCd > 0f) return
        nearestEnemy(2.6f)?.let { faceToward(it) }
        p.attackCd = 0.42f
        p.swing = 0.25f
        sfx.swing()
        var hitAny = false
        for (e in enemies) {
            val dx = e.x - p.x
            val dy = e.y - p.y
            val d = hypot(dx, dy)
            if (d > 1.35f + e.type.radius) continue
            val dot = if (d < 0.01f) 1f else (dx * p.faceX + dy * p.faceY) / d
            if (dot < 0.3f) continue
            damageEnemy(e, p.damage.toFloat(), 4f)
            hitAny = true
        }
        if (hitAny) sfx.hit()
    }

    fun fireball() {
        val p = player
        if (dead) return
        if (p.mana < 12f) {
            showMessage("Ikke nok mana", Color(0xFF64B5F6))
            return
        }
        p.mana -= 12f
        nearestEnemy(7f)?.let { faceToward(it) }
        p.swing = 0.15f
        projectiles += Projectile(
            p.x + p.faceX * 0.4f, p.y + p.faceY * 0.4f,
            p.faceX * 8f, p.faceY * 8f,
            p.damage * 1.6f, hostile = false, color = FIRE, life = 1.5f, radius = 0.2f,
        )
        sfx.fireball()
    }

    fun whirlwind() {
        val p = player
        if (dead) return
        if (p.mana < 20f) {
            showMessage("Ikke nok mana", Color(0xFF64B5F6))
            return
        }
        p.mana -= 20f
        p.whirl = 0.45f
        p.attackCd = 0.45f
        sfx.swing()
        var hitAny = false
        for (e in enemies) {
            if (dist(e) < 1.9f + e.type.radius) {
                damageEnemy(e, p.damage * 1.3f, 6f)
                hitAny = true
            }
        }
        if (hitAny) sfx.hit()
        repeat(24) {
            val a = it / 24f * 2f * PI.toFloat()
            particles += Particle(p.x + cos(a) * 1.2f, p.y + sin(a) * 1.2f, cos(a) * 2f, sin(a) * 2f, Color(0xFFCFD8DC), 0.05f, 0.35f)
        }
    }

    fun drinkPotion() {
        val p = player
        if (dead) return
        when {
            p.potions <= 0 -> showMessage("Ingen eliksirer", HURT_COLOR)
            p.hp >= p.maxHp -> showMessage("Du har fuldt liv", Color.White)
            else -> {
                p.potions--
                p.hp = min(p.maxHp, p.hp + p.maxHp * 0.45f)
                sfx.potion()
                burst(p.x, p.y, Color(0xFFFF5370), 20, glow = true)
            }
        }
    }

    // ---------- combat ----------

    private fun bloodColor(t: EnemyType) = when (t) {
        EnemyType.SLIME -> Color(0xFF66BB6A)
        EnemyType.SKELETON -> Color(0xFFE0D8C3)
        EnemyType.BAT -> Color(0xFF7B1FA2)
        EnemyType.BRUTE -> Color(0xFF8E1B1B)
        EnemyType.BOSS -> Color(0xFFFF5722)
    }

    private fun damageEnemy(e: Enemy, base: Float, knock: Float) {
        val crit = rnd.nextInt(100) < player.critChance
        val dmg = base * (0.85f + rnd.nextFloat() * 0.3f) * (if (crit) 2f else 1f)
        e.hp -= dmg
        e.flash = 0.12f
        e.aggro = true
        val dx = e.x - player.x
        val dy = e.y - player.y
        val d = hypot(dx, dy).coerceAtLeast(0.01f)
        val k = if (e.type == EnemyType.BOSS) knock * 0.15f else knock
        e.kx += dx / d * k
        e.ky += dy / d * k
        texts += FloatText(e.x, e.y - 0.7f, dmg.roundToInt().toString(), if (crit) GOLD else Color.White, big = crit)
        burst(e.x, e.y, bloodColor(e.type), 6)
        if (crit) shake = max(shake, 0.3f)
    }

    private fun hurtPlayer(raw: Float) {
        val dmg = raw * 100f / (100f + player.armorValue * 4f)
        player.hp -= dmg
        player.hurt = 0.3f
        player.sinceHurt = 0f
        shake = max(shake, 0.4f)
        sfx.hurt()
        texts += FloatText(player.x, player.y - 0.9f, "-${dmg.roundToInt()}", HURT_COLOR)
        burst(player.x, player.y, Color(0xFFB71C1C), 8)
        if (player.hp <= 0f) {
            player.hp = 0f
            dead = true
            attackHeld = false
        }
    }

    private fun kill(e: Enemy) {
        sfx.kill()
        burst(e.x, e.y, bloodColor(e.type), 18)
        gainXp(e.xp)
        dropLoot(e)
        if (e.type == EnemyType.BOSS) {
            showMessage("Dæmonherren er besejret!", GOLD)
            shake = 1f
            burst(e.x, e.y, GOLD, 60, glow = true)
        }
    }

    private fun gainXp(amount: Int) {
        val p = player
        p.xp += amount
        texts += FloatText(p.x, p.y - 1.2f, "+$amount XP", XP_COLOR)
        while (p.xp >= p.xpToNext) {
            p.xp -= p.xpToNext
            p.level++
            p.hp = p.maxHp
            p.mana = p.maxMana
            levelFlash = 1.2f
            sfx.levelUp()
            showMessage("Niveau ${p.level}!", GOLD)
            burst(p.x, p.y, GOLD, 40, glow = true)
            save()
        }
    }

    private fun jitter() = (rnd.nextFloat() - 0.5f) * 0.5f

    private fun dropLoot(e: Enemy) {
        val boss = e.type == EnemyType.BOSS
        if (boss || rnd.nextFloat() < 0.6f) {
            val amount = rnd.nextInt(3, 11) * floor * (if (boss) 10 else 1)
            loot += Loot(e.x + jitter(), e.y + jitter(), LootKind.Gold(amount))
        }
        if (rnd.nextFloat() < (if (boss) 1f else 0.12f)) loot += Loot(e.x + jitter(), e.y + jitter(), LootKind.Potion)
        val gearChance = when (e.type) {
            EnemyType.BOSS -> 1f
            EnemyType.BRUTE -> 0.45f
            else -> 0.18f
        }
        repeat(if (boss) 2 else 1) {
            if (rnd.nextFloat() < gearChance) loot += Loot(e.x + jitter(), e.y + jitter(), LootKind.Gear(makeItem(boss)))
        }
    }

    private fun makeItem(boss: Boolean): Item {
        val roll = rnd.nextFloat()
        val rarity = when {
            roll < (if (boss) 0.3f else 0.03f) -> Rarity.LEGENDARY
            roll < (if (boss) 0.8f else 0.13f) -> Rarity.RARE
            roll < (if (boss) 1f else 0.42f) -> Rarity.MAGIC
            else -> Rarity.COMMON
        }
        val ilvl = floor + player.level / 2
        val m = rarity.mult
        fun v(base: Float) = (base * m * (0.8f + rnd.nextFloat() * 0.4f)).roundToInt().coerceAtLeast(1)
        val slot = Slot.entries.random(rnd)
        val name = itemName(slot, rarity)
        return when (slot) {
            Slot.WEAPON -> Item(
                slot, name, rarity,
                damage = v(2f + ilvl * 1.6f),
                armor = 0,
                life = if (rarity >= Rarity.RARE) v(ilvl * 2f) else 0,
                crit = if (rarity >= Rarity.MAGIC) v(1.5f) else 0,
            )
            Slot.ARMOR -> Item(slot, name, rarity, damage = 0, armor = v(2f + ilvl * 1.4f), life = v(4f + ilvl * 3f), crit = 0)
            Slot.RING -> Item(
                slot, name, rarity,
                damage = if (rarity >= Rarity.MAGIC) v(1f + ilvl * 0.6f) else 0,
                armor = 0,
                life = v(3f + ilvl * 2f),
                crit = v(2f),
            )
        }
    }

    private fun itemName(slot: Slot, rarity: Rarity): String {
        val base = when (slot) {
            Slot.WEAPON -> weaponBases
            Slot.ARMOR -> armorBases
            Slot.RING -> ringBases
        }.random(rnd)
        return when (rarity) {
            Rarity.LEGENDARY -> legendaryNames.getValue(slot).random(rnd)
            Rarity.COMMON -> base
            else -> "${prefixes.random(rnd)} $base"
        }
    }

    fun equipped(slot: Slot): Item? = when (slot) {
        Slot.WEAPON -> player.weapon
        Slot.ARMOR -> player.armor
        Slot.RING -> player.ring
    }

    private fun equip(item: Item) {
        when (item.slot) {
            Slot.WEAPON -> player.weapon = item
            Slot.ARMOR -> player.armor = item
            Slot.RING -> player.ring = item
        }
        player.hp = min(player.hp, player.maxHp)
    }

    private fun collect(kind: LootKind) {
        val p = player
        when (kind) {
            is LootKind.Gold -> {
                p.gold += kind.amount
                sfx.coin()
                texts += FloatText(p.x, p.y - 1f, "+${kind.amount} guld", GOLD)
            }
            LootKind.Potion -> {
                p.potions++
                sfx.coin()
                texts += FloatText(p.x, p.y - 1f, "+1 eliksir", Color(0xFFFF5370))
            }
            is LootKind.Gear -> {
                val item = kind.item
                val current = equipped(item.slot)
                if (current == null || item.power > current.power) {
                    equip(item)
                    sfx.equip()
                    showMessage("Udstyret: ${item.name} (${item.statLine()})", item.rarity.color)
                } else {
                    val price = max(1, item.power * 2)
                    p.gold += price
                    sfx.coin()
                    showMessage("Solgte ${item.name} for $price guld", item.rarity.color)
                }
                save()
            }
        }
    }

    // ---------- world simulation ----------

    private fun updateEnemies(dt: Float) {
        val iter = enemies.iterator()
        while (iter.hasNext()) {
            val e = iter.next()
            if (e.hp <= 0f) {
                iter.remove()
                kill(e)
                continue
            }
            e.flash = max(0f, e.flash - dt)
            e.anim += dt
            if (e.kx != 0f || e.ky != 0f) {
                move(e, (e.kx * dt).coerceIn(-0.25f, 0.25f), (e.ky * dt).coerceIn(-0.25f, 0.25f), e.type.radius)
                val damp = 1f - min(1f, dt * 8f)
                e.kx *= damp
                e.ky *= damp
                if (abs(e.kx) < 0.05f && abs(e.ky) < 0.05f) {
                    e.kx = 0f
                    e.ky = 0f
                }
            }

            val dx = player.x - e.x
            val dy = player.y - e.y
            val d = hypot(dx, dy).coerceAtLeast(0.001f)
            if (!e.aggro && d < e.type.aggro) e.aggro = true
            if (!e.aggro) continue
            e.cooldown -= dt

            if (e.windup > 0f) {
                e.windup -= dt
                if (e.windup <= 0f) {
                    if (d <= e.type.range + 0.5f) hurtPlayer(e.dmg)
                    e.cooldown = e.type.cooldown
                }
                continue
            }

            if (e.type == EnemyType.BOSS) {
                e.special -= dt
                if (e.special <= 0f) {
                    e.special = 3.5f
                    bossVolley(e)
                }
            }

            if (d <= e.type.range + 0.3f && e.cooldown <= 0f) {
                e.windup = e.type.windup
                continue
            }
            if (d > e.type.range * 0.7f) {
                var mx = dx / d
                var my = dy / d
                if (e.type == EnemyType.BAT) {
                    val wob = sin(time * 6f + e.phase)
                    val px = -my
                    val py = mx
                    mx += px * wob * 0.8f
                    my += py * wob * 0.8f
                }
                move(e, mx * e.type.speed * dt, my * e.type.speed * dt, e.type.radius)
            }
        }

        // Keep enemies from stacking on top of each other.
        for (i in enemies.indices) for (j in i + 1 until enemies.size) {
            val a = enemies[i]
            val b = enemies[j]
            val dx = b.x - a.x
            val dy = b.y - a.y
            val d = hypot(dx, dy)
            val minD = a.type.radius + b.type.radius
            if (d < minD && d > 0.001f) {
                val push = (minD - d) / 2f
                move(a, -dx / d * push, -dy / d * push, a.type.radius)
                move(b, dx / d * push, dy / d * push, b.type.radius)
            }
        }
    }

    private fun bossVolley(e: Enemy) {
        sfx.fireball()
        repeat(10) {
            val a = it / 10f * 2f * PI.toFloat() + time
            projectiles += Projectile(e.x, e.y, cos(a) * 4.5f, sin(a) * 4.5f, e.dmg * 0.6f, hostile = true, color = Color(0xFFFF3D00), life = 3f)
        }
    }

    private fun updateProjectiles(dt: Float) {
        val iter = projectiles.iterator()
        while (iter.hasNext()) {
            val pr = iter.next()
            pr.life -= dt
            val nx = pr.x + pr.vx * dt
            val ny = pr.y + pr.vy * dt
            var explode = pr.life <= 0f || !dungeon.walkableAt(nx, ny)
            if (!explode) {
                pr.x = nx
                pr.y = ny
                if (pr.hostile) {
                    if (hypot(player.x - pr.x, player.y - pr.y) < 0.35f + pr.radius) {
                        hurtPlayer(pr.dmg)
                        explode = true
                    }
                } else if (enemies.any { e -> hypot(e.x - pr.x, e.y - pr.y) < e.type.radius + pr.radius }) {
                    explode = true
                }
            }
            if (particles.size < 500) {
                particles += Particle(
                    pr.x, pr.y, (rnd.nextFloat() - 0.5f) * 0.6f, (rnd.nextFloat() - 0.5f) * 0.6f,
                    pr.color, 0.07f, 0.3f, glow = true,
                )
            }
            if (explode) {
                iter.remove()
                if (!pr.hostile) {
                    for (e in enemies) if (hypot(e.x - pr.x, e.y - pr.y) < 1.3f + e.type.radius) damageEnemy(e, pr.dmg, 3f)
                    sfx.explode()
                    shake = max(shake, 0.35f)
                }
                burst(pr.x, pr.y, pr.color, 22, glow = true)
            }
        }
    }

    private fun updateLoot() {
        val iter = loot.iterator()
        while (iter.hasNext()) {
            val l = iter.next()
            if (hypot(l.x - player.x, l.y - player.y) < 0.6f) {
                iter.remove()
                collect(l.kind)
            }
        }
    }

    private fun reveal() {
        val px = floorInt(player.x)
        val py = floorInt(player.y)
        for (y in py - 6..py + 6) for (x in px - 6..px + 6) {
            if (x in 0 until dungeon.w && y in 0 until dungeon.h && (x - px) * (x - px) + (y - py) * (y - py) <= 36) {
                explored[y * dungeon.w + x] = true
            }
        }
    }

    fun burst(x: Float, y: Float, color: Color, count: Int, glow: Boolean = false) {
        repeat(count) {
            if (particles.size >= 500) return
            val a = rnd.nextFloat() * 2f * PI.toFloat()
            val s = 1f + rnd.nextFloat() * 3f
            particles += Particle(
                x, y, cos(a) * s, sin(a) * s - 1f, color,
                size = 0.04f + rnd.nextFloat() * 0.07f,
                life = 0.4f + rnd.nextFloat() * 0.5f,
                glow = glow,
                gravity = if (glow) 0f else 6f,
            )
        }
    }

    private fun updateParticles(dt: Float) {
        val iter = particles.iterator()
        while (iter.hasNext()) {
            val pt = iter.next()
            pt.age += dt
            if (pt.age >= pt.life) {
                iter.remove()
                continue
            }
            pt.x += pt.vx * dt
            pt.y += pt.vy * dt
            pt.vy += pt.gravity * dt
            val damp = 1f - min(1f, dt * 3f)
            pt.vx *= damp
            pt.vy *= damp
        }
    }

    private fun updateTexts(dt: Float) {
        val iter = texts.iterator()
        while (iter.hasNext()) {
            val t = iter.next()
            t.age += dt
            t.y -= dt * 0.9f
            if (t.age > (if (t.big) 1.3f else 1f)) iter.remove()
        }
    }
}
