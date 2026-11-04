package com.airmour.markmap.ui

import com.google.gson.JsonParser
import com.google.gson.GsonBuilder
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.ValidationInfo
import com.intellij.ui.components.JBScrollPane
import java.awt.BorderLayout
import java.awt.GridLayout
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.JTextArea

class MarkmapSettingsDialog : DialogWrapper(true) {
    private val options = JTextArea(MarkmapSettings.getInstance().getState().options, 6, 60)
    private val css = JTextArea(MarkmapSettings.getInstance().getState().customCss, 8, 60)
    init { title = "Markmap Settings"; init() }
    override fun createCenterPanel(): JComponent = JPanel(GridLayout(2, 1, 0, 8)).apply {
        add(JPanel(BorderLayout()).apply {
            add(JLabel("Default Markmap options (JSON):"), BorderLayout.NORTH)
            add(JBScrollPane(options), BorderLayout.CENTER)
        })
        add(JPanel(BorderLayout()).apply {
            add(JLabel("Custom CSS:"), BorderLayout.NORTH)
            add(JBScrollPane(css), BorderLayout.CENTER)
        })
    }
    override fun doValidate(): ValidationInfo? = try {
        if (!JsonParser.parseString(options.text).isJsonObject) ValidationInfo("Options must be a JSON object", options) else null
    } catch (_: Exception) { ValidationInfo("Enter valid JSON options", options) }
    override fun doOKAction() {
        MarkmapSettings.getInstance().getState().apply {
            options = GsonBuilder().setPrettyPrinting().create().toJson(JsonParser.parseString(this@MarkmapSettingsDialog.options.text))
            customCss = css.text
        }
        super.doOKAction()
    }
}
