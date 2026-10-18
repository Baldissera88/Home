package com.baldissera.stickypaws

import android.annotation.SuppressLint
import android.graphics.Color
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/**
 * Sticky Paws is a self-contained web game in assets/web. It is served from
 * https://appassets.androidplatform.net so the page gets a stable origin and its localStorage save survives.
 */
class MainActivity : ComponentActivity() {
    private lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#1E2148"))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mediaPlaybackRequiresUserGesture = false
            settings.textZoom = 100
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false
            overScrollMode = WebView.OVER_SCROLL_NEVER
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                    val url = request.url
                    if (url.host != HOST) return null
                    return serve(url.path ?: return null)
                }

                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = request.url.host != HOST
            }
        }
        // Keep the game clear of the status bar, navigation bar and camera cut-outs (Android 15 draws edge to edge).
        // The padding goes on a frame around the WebView: a WebView draws its page under its own padding.
        val frame = FrameLayout(this).apply {
            setBackgroundColor(Color.parseColor("#1E2148"))
            addView(web, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        }
        ViewCompat.setOnApplyWindowInsetsListener(frame) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
        setContentView(frame)
        web.loadUrl("https://$HOST/assets/web/index.html")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                web.evaluateJavascript("window.androidBack ? window.androidBack() : false") { handled ->
                    if (handled != "true") finish()
                }
            }
        })
    }

    private fun serve(path: String): WebResourceResponse? {
        if (!path.startsWith("/assets/")) return null
        val name = path.removePrefix("/assets/")
        val stream = try {
            assets.open(name)
        } catch (e: java.io.IOException) {
            return WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), null)
        }
        val mime = when (name.substringAfterLast('.')) {
            "html" -> "text/html"
            "js" -> "text/javascript"
            "css" -> "text/css"
            "ttf" -> "font/ttf"
            "png" -> "image/png"
            else -> "application/octet-stream"
        }
        return WebResourceResponse(mime, "utf-8", stream)
    }

    override fun onPause() {
        web.onPause()
        web.pauseTimers()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        web.resumeTimers()
        web.onResume()
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }

    private companion object {
        const val HOST = "appassets.androidplatform.net"
    }
}
