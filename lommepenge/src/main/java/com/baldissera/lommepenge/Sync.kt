package com.baldissera.lommepenge

import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/** Where the family's data lives online; the Store only talks to this, so tests can swap in a fake. */
interface Remote {
    /** Streams the family's data: [onData] gets (path, value) for every change, starting with the whole tree at "/". */
    fun start(code: String, onData: (String, Any?) -> Unit, onState: (SyncState) -> Unit)

    /** Sends one set of path → value writes; [done] runs once the server has stored it (retrying until then). */
    fun send(code: String, update: JSONObject, done: (JSONObject) -> Unit)

    fun stop()
}

/**
 * Firebase Realtime Database over its plain REST API: an event stream for reading and PATCH for writing, so the
 * app needs no Firebase SDK. Callbacks run on the main thread.
 */
class FirebaseRemote(private val databaseUrl: String) : Remote {
    private val main = Handler(Looper.getMainLooper())
    private val sender = Executors.newSingleThreadExecutor()
    @Volatile private var listener: Thread? = null
    @Volatile private var conn: HttpURLConnection? = null

    private fun url(code: String) = "${databaseUrl.trimEnd('/')}/families/$code.json"

    override fun start(code: String, onData: (String, Any?) -> Unit, onState: (SyncState) -> Unit) {
        stop()
        val t = Thread {
            var wait = 2000L
            while (listener === Thread.currentThread()) {
                main.post { onState(SyncState.CONNECTING) }
                try {
                    val c = URL(url(code)).openConnection() as HttpURLConnection
                    conn = c
                    c.setRequestProperty("Accept", "text/event-stream")
                    c.connectTimeout = 15_000
                    c.readTimeout = 75_000 // the server sends a keep-alive every 30 s
                    if (c.responseCode != 200) throw IOException("HTTP ${c.responseCode}")
                    main.post { onState(SyncState.ONLINE) }
                    wait = 2000L
                    c.inputStream.bufferedReader().use { r ->
                        var event = ""
                        while (listener === Thread.currentThread()) {
                            val line = r.readLine() ?: break
                            if (line.startsWith("event:")) event = line.substring(6).trim()
                            else if (line.startsWith("data:")) handle(event, line.substring(5).trim(), onData, onState)
                        }
                    }
                } catch (_: Exception) {
                }
                conn = null
                if (listener !== Thread.currentThread()) break
                main.post { onState(SyncState.OFFLINE) }
                try {
                    Thread.sleep(wait)
                } catch (_: InterruptedException) {
                    break
                }
                wait = (wait * 2).coerceAtMost(30_000)
            }
        }
        listener = t
        t.isDaemon = true
        t.start()
    }

    private fun handle(event: String, data: String, onData: (String, Any?) -> Unit, onState: (SyncState) -> Unit) {
        when (event) {
            "put", "patch" -> {
                val o = JSONObject(data)
                val path = o.optString("path", "/")
                val d = o.opt("data")
                main.post {
                    if (event == "patch" && d is JSONObject) {
                        for (k in d.keys()) onData("${path.trimEnd('/')}/$k", d.get(k))
                    } else {
                        onData(path, d)
                    }
                }
            }
            "cancel", "auth_revoked" -> main.post { onState(SyncState.ERROR) }
        }
    }

    override fun send(code: String, update: JSONObject, done: (JSONObject) -> Unit) {
        val body = update.toString().toByteArray()
        sender.execute {
            var wait = 2000L
            while (true) {
                try {
                    val c = URL(url(code)).openConnection() as HttpURLConnection
                    // HttpURLConnection can't send PATCH; Firebase accepts it as an override on POST.
                    c.requestMethod = "POST"
                    c.setRequestProperty("X-HTTP-Method-Override", "PATCH")
                    c.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                    c.connectTimeout = 15_000
                    c.readTimeout = 30_000
                    c.doOutput = true
                    c.outputStream.use { it.write(body) }
                    val ok = c.responseCode in 200..299
                    c.disconnect()
                    if (ok) {
                        main.post { done(update) }
                        return@execute
                    }
                } catch (_: Exception) {
                }
                try {
                    Thread.sleep(wait)
                } catch (_: InterruptedException) {
                    return@execute
                }
                wait = (wait * 2).coerceAtMost(60_000)
            }
        }
    }

    override fun stop() {
        val t = listener
        listener = null
        conn?.disconnect()
        t?.interrupt()
    }
}
