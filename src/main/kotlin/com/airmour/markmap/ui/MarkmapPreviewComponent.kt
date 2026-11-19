package com.airmour.markmap.ui

import com.google.gson.JsonParser
import com.google.gson.Gson
import com.intellij.ide.BrowserUtil
import com.intellij.ide.ui.LafManagerListener
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefBrowserBase
import com.intellij.ui.jcef.JBCefJSQuery
import com.intellij.ui.components.Magnificator
import com.intellij.ui.components.ZoomableViewport
import com.intellij.openapi.fileEditor.OpenFileDescriptor
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VirtualFile
import com.airmour.markmap.utils.MarkmapTemplateManager
import com.airmour.markmap.utils.LocalDocumentFiles
import java.net.URI
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.util.Collections
import java.util.Base64
import javax.swing.JComponent
import javax.swing.JPanel
import java.awt.BorderLayout
import java.awt.Point

class MarkmapPreviewComponent(private val project: Project, private val file: VirtualFile, private val onFocusLine: (Int) -> Unit) {
    private val browser = JBCefBrowser()
    private val previewPanel = object : JPanel(BorderLayout()), ZoomableViewport {
        private var pinching = false

        init { add(browser.component, BorderLayout.CENTER) }

        // IDE gesture dispatch discovers ZoomableViewport ancestors with a Magnificator.
        override fun getMagnificator(): Magnificator = Magnificator { _, point -> point }

        override fun magnificationStarted(at: Point) {
            if (!ready || disposed || width <= 0 || height <= 0) return
            pinching = true
            executeJavaScript("window.beginNativePinch(${at.x.toDouble() / width}, ${at.y.toDouble() / height});")
        }

        override fun magnify(magnification: Double) {
            if (!pinching || !magnification.isFinite()) return
            val scale = if (magnification >= 0) 1 + magnification else 1 / (1 - magnification)
            executeJavaScript("window.updateNativePinch($scale);")
        }

        override fun magnificationFinished(magnification: Double) {
            if (!pinching) return
            magnify(magnification)
            executeJavaScript("window.endNativePinch();")
            pinching = false
        }
    }
    private val query = JBCefJSQuery.create(browser as JBCefBrowserBase)
    private val imageQuery = JBCefJSQuery.create(browser as JBCefBrowserBase)
    private val imageCache = Collections.synchronizedMap(mutableMapOf<String, String>())
    private val templateManager = MarkmapTemplateManager()
    private val connection = ApplicationManager.getApplication().messageBus.connect()
    private var ready = false
    private var disposed = false
    private var content = ""
    private var cursorLine = 0
    private var lastSentCursorLine: Int? = null
    private var svgCallback: ((String) -> Unit)? = null
    private var htmlCallback: ((String) -> Unit)? = null

    init {
        query.addHandler { message ->
            try {
                val data = JsonParser.parseString(message).asJsonObject
                val type = data.get("type")?.asString
                val value = data.get("value")
                ApplicationManager.getApplication().invokeLater({
                    if (!disposed) when (type) {
                        "ready" -> { ready = true; updateContent(content); updateCursor(cursorLine) }
                        "focus" -> value?.asInt?.let(onFocusLine)
                        "svg" -> { val callback = svgCallback; svgCallback = null; value?.asString?.let { callback?.invoke(it) } }
                        "htmlReady" -> {
                            val callback = htmlCallback
                            htmlCallback = null
                            val snapshot = value?.takeIf { it.isJsonObject }?.asJsonObject
                            if (callback != null && snapshot != null) {
                                val paths = snapshot.getAsJsonArray("images")?.map { it.asString } ?: emptyList()
                                callback(createExportHtml(
                                    snapshot.get("content")?.asString ?: "",
                                    snapshot.get("options")?.toString() ?: "{}",
                                    snapshot.get("customCSS")?.asString ?: "",
                                    paths
                                ))
                            }
                        }
                        "link" -> value?.asString?.let(::openLink)
                    }
                }, ModalityState.nonModal())
            } catch (_: Exception) { }
            null
        }
        imageQuery.addHandler { src -> JBCefJSQuery.Response(resolveImage(src)) }
        connection.subscribe(LafManagerListener.TOPIC, LafManagerListener { reload() })
        reload()
    }

    private fun reload() {
        if (disposed) return
        ready = false
        lastSentCursorLine = null
        val bridge = """
            window.markmapSend = function(message) { ${query.inject("JSON.stringify(message)")} };
            window.markmapResolveImage = function(src) { return new Promise(resolve => {
                ${imageQuery.inject("src", "response => resolve(response)", "(code, message) => resolve('')")}
            }); };
        """.trimIndent()
        browser.loadHTML(templateManager.createMarkmapHtml(bridge))
    }

    private fun encode(value: String) = Base64.getEncoder().encodeToString(value.toByteArray(Charsets.UTF_8))
    private fun decode(value: String) = "new TextDecoder('utf-8').decode(Uint8Array.from(atob('${encode(value)}'), c => c.charCodeAt(0)))"

    fun updateContent(value: String) {
        content = value
        if (!ready || disposed) return
        val settings = MarkmapSettings.getInstance()
        executeJavaScript("window.setMarkmapContent(${decode(value)}, JSON.parse(${decode(settings.getState().options)}), ${decode(settings.getState().customCss)});")
    }

    fun updateCursor(line: Int) {
        cursorLine = line
        if (!ready || disposed || lastSentCursorLine == line) return
        lastSentCursorLine = line
        executeJavaScript("window.setMarkmapCursor($line);")
    }

    fun exportSvg(callback: (String) -> Unit) {
        if (!ready) return
        svgCallback = callback
        executeJavaScript("window.exportSvg();")
    }

    fun exportHtml(callback: (String) -> Unit) {
        if (!ready) return
        htmlCallback = callback
        executeJavaScript("window.requestHtmlExport();")
    }

    private fun createExportHtml(content: String, options: String, css: String, paths: List<String>): String {
        val images = synchronized(imageCache) { Gson().toJson(imageCache.filterKeys { it in paths }) }
        val bridge = "window.markmapResolveImage = src => Promise.resolve((${images})[src] || '');"
        return templateManager.createMarkmapHtml(bridgeScript = bridge, initialContent = content, options = options, css = css)
    }

    private fun localPath(raw: String): Path? {
        val parent = file.parent ?: return null
        return LocalDocumentFiles.resolve(Paths.get(parent.path), raw)
    }

    private fun resolveImage(src: String): String {
        val result = try {
            val path = localPath(src) ?: return ""
            val type = when (path.fileName.toString().substringAfterLast('.', "").lowercase()) {
                "png" -> "image/png"; "jpg", "jpeg" -> "image/jpeg"; "gif" -> "image/gif"
                "webp" -> "image/webp"; "svg" -> "image/svg+xml"; else -> return ""
            }
            if (Files.size(path) > 10L * 1024 * 1024) return ""
            "data:$type;base64,${Base64.getEncoder().encodeToString(Files.readAllBytes(path))}"
        } catch (_: Exception) { "" }
        if (result.isNotEmpty()) imageCache[src] = result
        return result
    }

    private fun openLink(href: String) {
        val uri = try { URI(href) } catch (_: Exception) { return }
        if (uri.scheme == "https" || uri.scheme == "http" || uri.scheme == "mailto") {
            BrowserUtil.browse(href)
        } else if (uri.scheme == null) {
            val path = localPath(href) ?: return
            LocalFileSystem.getInstance().refreshAndFindFileByNioFile(path)?.let {
                OpenFileDescriptor(project, it).navigate(true)
            }
        }
    }

    fun executeJavaScript(script: String) {
        if (ready && !disposed) browser.cefBrowser.executeJavaScript(script, browser.cefBrowser.url, 0)
    }

    fun getComponent(): JComponent = previewPanel
    fun getBrowserComponent(): JComponent = previewPanel
    fun dispose() {
        disposed = true
        connection.disconnect()
        query.dispose()
        imageQuery.dispose()
        browser.dispose()
    }
}
