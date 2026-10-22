package com.baldissera.rpg

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color as AndroidColor
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebMessage
import android.webkit.WebMessagePort
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.InputStream

/**
 * The 3D view: a WebView running the three.js renderer from assets/web. The game stays in Kotlin;
 * every display frame this posts the moving state (see [Wire]) and, when the map changes, the level.
 * Pages are served from https://appassets.androidplatform.net so ES modules load: /assets/... from the
 * APK's assets and /res/<type>/<name>.<ext> from its resources (textures and fonts the 2D game uses too).
 */
@SuppressLint("SetJavaScriptEnabled")
class Scene3D(context: Context, private val quality: String, private val onFail: (String) -> Unit) {
    private val main = Handler(Looper.getMainLooper())
    private val res = context.resources
    private val assets = context.assets
    private val pkg = context.packageName

    /** True once the page has loaded its models and listens for frames. */
    var ready = false
        private set
    var failed = false
        private set
    private var sentLevel: Any? = null
    private var sentQuest = -1
    private var sentPitch = Float.NaN
    private var sentDist = Float.NaN
    private var destroyed = false
    /** Our end of a message channel to the page; frames go here instead of through the window when it is open. */
    private var port: WebMessagePort? = null
    private val origin = Uri.parse("https://$HOST")

    val view: WebView = WebView(context).apply {
        setBackgroundColor(AndroidColor.BLACK)
        settings.javaScriptEnabled = true
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.mediaPlaybackRequiresUserGesture = true
        settings.offscreenPreRaster = true
        // Keep the renderer process important while the game shows it (API 26, our minSdk).
        setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, true)
        isVerticalScrollBarEnabled = false
        isHorizontalScrollBarEnabled = false
        overScrollMode = WebView.OVER_SCROLL_NEVER
        // The HUD above handles every touch; the page only draws.
        isFocusable = false
        isClickable = false
        addJavascriptInterface(Bridge(), "Android")
        webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                val url = request.url
                if (url.host != HOST) return null
                return serve(url.path ?: return null)
            }

            override fun onRenderProcessGone(view: WebView, detail: android.webkit.RenderProcessGoneDetail): Boolean {
                fail("renderer process gone")
                return true
            }
        }
        loadUrl("https://$HOST/assets/web/index.html?q=$quality")
    }

    private fun serve(path: String): WebResourceResponse? {
        val stream: InputStream = try {
            when {
                path.startsWith("/assets/") -> assets.open(path.removePrefix("/assets/"))
                path.startsWith("/res/") -> {
                    val parts = path.removePrefix("/res/").split('/')
                    if (parts.size != 2) return notFound()
                    val type = parts[0].substringBefore('-')
                    val id = res.getIdentifier(parts[1].substringBeforeLast('.'), type, pkg)
                    if (id == 0) return notFound()
                    res.openRawResource(id)
                }
                else -> return notFound()
            }
        } catch (e: Exception) {
            return notFound()
        }
        val response = WebResourceResponse(mime(path), if (path.endsWith(".js") || path.endsWith(".html")) "utf-8" else null, stream)
        response.responseHeaders = mapOf("Cache-Control" to "max-age=86400")
        return response
    }

    private fun notFound() = WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), "".byteInputStream())

    private fun mime(path: String) = when (path.substringAfterLast('.').lowercase()) {
        "html" -> "text/html"
        "js" -> "text/javascript"
        "json" -> "application/json"
        "glb" -> "model/gltf-binary"
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "ttf" -> "font/ttf"
        else -> "application/octet-stream"
    }

    private inner class Bridge {
        @JavascriptInterface
        fun ready() = main.post {
            if (destroyed) return@post
            this@Scene3D.ready = true
            sentLevel = null
            sentPitch = Float.NaN
            openPort()
        }

        @JavascriptInterface
        fun error(message: String) = main.post { fail(message) }
    }

    private fun fail(message: String) {
        Log.e("Scene3D", message)
        if (failed) return
        failed = true
        onFail(message)
    }

    /** Hands the page one end of a fresh message channel (main.js listens for "port"); we keep the other. */
    private fun openPort() {
        closePort()
        port = try {
            val ports = view.createWebMessageChannel()
            view.postWebMessage(WebMessage("port", arrayOf<WebMessagePort>(ports[1])), origin)
            ports[0]
        } catch (e: Exception) {
            Log.w("Scene3D", "message channel unavailable", e)
            null
        }
    }

    private fun closePort() {
        val p = port ?: return
        port = null
        try {
            p.close()
        } catch (e: Exception) {
            // already closed
        }
    }

    private fun post(json: String) {
        val p = port
        if (p != null) {
            try {
                p.postMessage(WebMessage(json))
                return
            } catch (e: Exception) {
                Log.w("Scene3D", "port post failed, using postWebMessage", e)
                closePort()
            }
        }
        try {
            view.postWebMessage(WebMessage(json), origin)
        } catch (e: Exception) {
            Log.w("Scene3D", "postWebMessage failed", e)
        }
    }

    /** Sends the level when it changed, the camera when it moved, and this frame. Call on the main thread. */
    fun push(g: Game) {
        if (!ready || failed || destroyed || !view.isAttachedToWindow) return
        if (sentLevel !== g.dungeon || sentQuest != g.questStage) {
            sentLevel = g.dungeon
            sentQuest = g.questStage
            post(Wire.level(g))
        }
        if (g.camPitch != sentPitch || g.camDist != sentDist) {
            sentPitch = g.camPitch
            sentDist = g.camDist
            post("{\"k\":\"cam\",\"p\":${g.camPitch},\"d\":${g.camDist}}")
        }
        post(Wire.frame(g, g.camYaw))
    }

    fun pause() = view.onPause()

    fun resume() = view.onResume()

    fun destroy() {
        if (destroyed) return
        destroyed = true
        ready = false
        closePort()
        view.removeJavascriptInterface("Android")
        view.destroy()
    }

    companion object {
        const val HOST = "appassets.androidplatform.net"
    }
}
