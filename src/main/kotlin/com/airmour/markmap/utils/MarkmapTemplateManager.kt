package com.airmour.markmap.utils

import com.intellij.util.ui.UIUtil
import java.awt.Color
import java.util.Base64

class MarkmapTemplateManager {
    private val resourceLoader = MarkmapResourceLoader()

    private fun colorHex(color: Color) = "#%02x%02x%02x".format(color.red, color.green, color.blue)
    private fun safeScript(script: String) = script.replace("</script", "<\\/script", ignoreCase = true)

    fun createMarkmapHtml(bridgeScript: String = "", initialContent: String? = null, options: String = "{}", css: String = ""): String {
        val initialScript = if (initialContent == null) "" else {
            val payload = listOf(initialContent, options, css).map {
                Base64.getEncoder().encodeToString(it.toByteArray(Charsets.UTF_8))
            }
            """
                const decode = s => new TextDecoder('utf-8').decode(Uint8Array.from(atob(s), c => c.charCodeAt(0)));
                window.setMarkmapContent(decode('${payload[0]}'), JSON.parse(decode('${payload[1]}')), decode('${payload[2]}'));
            """.trimIndent()
        }
        return resourceLoader.loadResource("/markmap/template.html")
            .replace("__BACKGROUND__", colorHex(UIUtil.getPanelBackground()))
            .replace("__FOREGROUND__", colorHex(UIUtil.getLabelForeground()))
            .replace("__KATEX_CSS__", resourceLoader.loadResource("/markmap/vendor/katex.css"))
            .replace("__VENDOR_JS__", safeScript(resourceLoader.loadResource("/markmap/vendor/markmap-bundle.js")))
            .replace("__BRIDGE_JS__", safeScript(bridgeScript))
            .replace("__APP_JS__", safeScript(resourceLoader.loadResource("/markmap/app.js") + "\n" + initialScript))
    }
}
