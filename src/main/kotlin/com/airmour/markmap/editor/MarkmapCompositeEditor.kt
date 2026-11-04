package com.airmour.markmap.editor

import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.*
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.editor.event.DocumentEvent
import com.intellij.openapi.editor.event.DocumentListener
import com.intellij.openapi.editor.event.CaretEvent
import com.intellij.openapi.editor.event.CaretListener
import com.intellij.openapi.editor.ScrollType
import com.intellij.openapi.fileChooser.FileChooserFactory
import com.intellij.openapi.fileChooser.FileSaverDescriptor
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.fileEditor.*
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.util.UserDataHolderBase
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.ui.JBSplitter
import com.intellij.util.Alarm
import com.airmour.markmap.ui.MarkmapPreviewComponent
import com.airmour.markmap.ui.MarkmapSettingsDialog
import org.jetbrains.annotations.NotNull
import org.jetbrains.annotations.Nullable
import java.awt.BorderLayout
import java.awt.event.ActionEvent
import java.beans.PropertyChangeListener
import java.io.File
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.AbstractAction
import javax.swing.KeyStroke

/**
 * Composite editor that combines text editor with markmap preview
 */
class MarkmapCompositeEditor(
    private val textEditor: TextEditor
) : UserDataHolderBase(), FileEditor {

    private val mainPanel: JPanel = JPanel(BorderLayout())
    private val resources = Disposer.newDisposable("Markmap editor resources")
    private val previewComponent = MarkmapPreviewComponent(textEditor.editor.project!!, textEditor.file) { line -> focusLine(line) }
    private val updateAlarm = Alarm(Alarm.ThreadToUse.SWING_THREAD, resources)
    private var disposed = false
    private var currentMode = ViewMode.SPLIT
    private var splitter: JBSplitter? = null

    enum class ViewMode {
        EDITOR_ONLY,
        SPLIT,
        PREVIEW_ONLY
    }

    init {
        setupShortcuts()
        setupContentSync()
        updateLayout()
    }

    private fun setupShortcuts() {
        val input = mainPanel.getInputMap(JComponent.WHEN_ANCESTOR_OF_FOCUSED_COMPONENT)
        input.put(KeyStroke.getKeyStroke("alt shift T"), "markmap.toggle")
        input.put(KeyStroke.getKeyStroke("alt shift R"), "markmap.toggleRecursive")
        mainPanel.actionMap.put("markmap.toggle", object : AbstractAction() {
            override fun actionPerformed(e: ActionEvent) = executeJavaScript("window.toggleActive(false);")
        })
        mainPanel.actionMap.put("markmap.toggleRecursive", object : AbstractAction() {
            override fun actionPerformed(e: ActionEvent) = executeJavaScript("window.toggleActive(true);")
        })
    }

    /**
     * Sync text editor changes with preview component
     */
    private fun setupContentSync() {
        ApplicationManager.getApplication().invokeLater({
            if (disposed) return@invokeLater
            val document = textEditor.editor.document

            document.addDocumentListener(object : DocumentListener {
                override fun documentChanged(event: DocumentEvent) {
                    updateAlarm.cancelAllRequests()
                    updateAlarm.addRequest({ previewComponent.updateContent(document.text) }, 250)
                }
            }, resources)

            textEditor.editor.caretModel.addCaretListener(object : CaretListener {
                override fun caretPositionChanged(event: CaretEvent) {
                    previewComponent.updateCursor(event.newPosition.line)
                }
            }, resources)

            // Initial sync
            val initialContent = document.text
            previewComponent.updateContent(initialContent)
            previewComponent.updateCursor(textEditor.editor.caretModel.logicalPosition.line)

        }, ModalityState.nonModal())
    }

    private fun createCombinedToolbar(): JComponent {
        val actionGroup = DefaultActionGroup()

        // View mode controls
        actionGroup.add(object :
            ToggleAction("Show Editor Only", "Show editor only", AllIcons.General.LayoutEditorOnly), DumbAware {
            override fun getActionUpdateThread() = ActionUpdateThread.EDT
            override fun isSelected(e: AnActionEvent): Boolean = currentMode == ViewMode.EDITOR_ONLY
            override fun setSelected(e: AnActionEvent, state: Boolean) {
                if (state) {
                    currentMode = ViewMode.EDITOR_ONLY
                    updateLayout()
                }
            }
        })

        actionGroup.add(object :
            ToggleAction("Show Editor and Preview", "Show editor and preview", AllIcons.General.LayoutEditorPreview),
            DumbAware {
            override fun getActionUpdateThread() = ActionUpdateThread.EDT
            override fun isSelected(e: AnActionEvent): Boolean = currentMode == ViewMode.SPLIT
            override fun setSelected(e: AnActionEvent, state: Boolean) {
                if (state) {
                    currentMode = ViewMode.SPLIT
                    updateLayout()
                }
            }
        })

        actionGroup.add(object :
            ToggleAction("Show Preview Only", "Show preview only", AllIcons.General.LayoutPreviewOnly), DumbAware {
            override fun getActionUpdateThread() = ActionUpdateThread.EDT
            override fun isSelected(e: AnActionEvent): Boolean = currentMode == ViewMode.PREVIEW_ONLY
            override fun setSelected(e: AnActionEvent, state: Boolean) {
                if (state) {
                    currentMode = ViewMode.PREVIEW_ONLY
                    updateLayout()
                }
            }
        })

        // Add separator between view controls and map controls
        actionGroup.addSeparator()

        // Mind map controls - only show when preview is visible (simplified to working controls only)
        if (currentMode == ViewMode.SPLIT || currentMode == ViewMode.PREVIEW_ONLY) {
            // Center/Fit action
            actionGroup.add(object : AnAction("Center View", "Center and fit the mind map", AllIcons.Graph.ActualZoom),
                DumbAware {
                override fun actionPerformed(e: AnActionEvent) {
                    executeJavaScript("if (typeof centerMap === 'function') centerMap();")
                }
            })

            // Zoom In
            actionGroup.add(object : AnAction("Zoom In", "Zoom in", AllIcons.Graph.ZoomIn), DumbAware {
                override fun actionPerformed(e: AnActionEvent) {
                    executeJavaScript("if (typeof zoomIn === 'function') zoomIn();")
                }
            })

            // Zoom Out
            actionGroup.add(object : AnAction("Zoom Out", "Zoom out", AllIcons.Graph.ZoomOut), DumbAware {
                override fun actionPerformed(e: AnActionEvent) {
                    executeJavaScript("if (typeof zoomOut === 'function') zoomOut();")
                }
            })
            actionGroup.add(object : AnAction("Toggle Active Node", "Toggle the node at the editor cursor", AllIcons.General.CollapseComponent), DumbAware {
                override fun actionPerformed(e: AnActionEvent) = executeJavaScript("window.toggleActive(false);")
            })
            actionGroup.add(object : AnAction("Toggle Node Recursively", "Toggle the active node and descendants", AllIcons.Actions.Collapseall), DumbAware {
                override fun actionPerformed(e: AnActionEvent) = executeJavaScript("window.toggleActive(true);")
            })
            actionGroup.add(object : AnAction("Export SVG", "Export the current mind map as SVG", AllIcons.ToolbarDecorator.Export), DumbAware {
                override fun actionPerformed(e: AnActionEvent) {
                    val target = chooseExport("svg") ?: return
                    previewComponent.updateContent(textEditor.editor.document.text)
                    previewComponent.exportSvg { writeExport(target, it) }
                }
            })
            actionGroup.add(object : AnAction("Export HTML", "Export a self-contained interactive mind map", AllIcons.ToolbarDecorator.Export), DumbAware {
                override fun actionPerformed(e: AnActionEvent) {
                    val target = chooseExport("html") ?: return
                    previewComponent.updateContent(textEditor.editor.document.text)
                    previewComponent.exportHtml { writeExport(target, it) }
                }
            })
            actionGroup.add(object : AnAction("Markmap Settings", "Edit default options and custom CSS", AllIcons.General.Settings), DumbAware {
                override fun actionPerformed(e: AnActionEvent) {
                    if (MarkmapSettingsDialog().showAndGet()) previewComponent.updateContent(textEditor.editor.document.text)
                }
            })
        }

        val toolbar = ActionManager.getInstance().createActionToolbar("MarkmapEditor", actionGroup, true)
        toolbar.targetComponent = mainPanel
        toolbar.component.isOpaque = false
        return toolbar.component
    }

    private fun executeJavaScript(script: String) {
        previewComponent.executeJavaScript(script)
    }

    private fun focusLine(line: Int) {
        val editor = textEditor.editor
        if (line !in 0 until editor.document.lineCount) return
        if (currentMode == ViewMode.PREVIEW_ONLY) { currentMode = ViewMode.SPLIT; updateLayout() }
        editor.caretModel.moveToOffset(editor.document.getLineStartOffset(line))
        editor.scrollingModel.scrollToCaret(ScrollType.CENTER)
        editor.contentComponent.requestFocusInWindow()
    }

    private fun chooseExport(extension: String): File? {
        val dialog = FileChooserFactory.getInstance().createSaveFileDialog(
            FileSaverDescriptor("Export Markmap", "Save the mind map", extension), mainPanel
        )
        return dialog.save(textEditor.file.parent, "${textEditor.file.nameWithoutExtension}.$extension")?.file
    }

    private fun writeExport(file: File, content: String) {
        try { file.writeText(content, Charsets.UTF_8) }
        catch (e: Exception) { Messages.showErrorDialog(mainPanel, e.message ?: "Cannot write file", "Markmap Export") }
    }

    private fun updateLayout() {
        mainPanel.removeAll()

        when (currentMode) {
            ViewMode.EDITOR_ONLY -> {
                val editorPanel = JPanel(BorderLayout())
                editorPanel.add(textEditor.component, BorderLayout.CENTER)

                val topPanel = JPanel(BorderLayout())
                topPanel.add(createCombinedToolbar(), BorderLayout.EAST)
                topPanel.isOpaque = false

                mainPanel.add(topPanel, BorderLayout.NORTH)
                mainPanel.add(editorPanel, BorderLayout.CENTER)
            }

            ViewMode.PREVIEW_ONLY -> {
                // For preview only, get the raw browser component without additional toolbar
                val previewPanel = JPanel(BorderLayout())
                previewPanel.add(previewComponent.getBrowserComponent(), BorderLayout.CENTER)

                val topPanel = JPanel(BorderLayout())
                topPanel.add(createCombinedToolbar(), BorderLayout.EAST)
                topPanel.isOpaque = false

                mainPanel.add(topPanel, BorderLayout.NORTH)
                mainPanel.add(previewPanel, BorderLayout.CENTER)
            }

            ViewMode.SPLIT -> {
                splitter = JBSplitter(false, 0.5f).apply {
                    firstComponent = textEditor.component
                    // For split mode, get the raw browser component without additional toolbar
                    secondComponent = previewComponent.getBrowserComponent()
                    setDividerWidth(1)
                }

                val topPanel = JPanel(BorderLayout())
                topPanel.add(createCombinedToolbar(), BorderLayout.EAST)
                topPanel.isOpaque = false

                mainPanel.add(topPanel, BorderLayout.NORTH)
                mainPanel.add(splitter, BorderLayout.CENTER)
            }
        }

        mainPanel.revalidate()
        mainPanel.repaint()
    }

    @NotNull
    override fun getComponent(): JComponent = mainPanel

    @Nullable
    override fun getPreferredFocusedComponent(): JComponent? = when (currentMode) {
        ViewMode.EDITOR_ONLY, ViewMode.SPLIT -> textEditor.preferredFocusedComponent
        ViewMode.PREVIEW_ONLY -> previewComponent.getComponent()
    }

    @NotNull
    override fun getName(): String = "Markmap"

    override fun setState(state: FileEditorState) {
        if (state is MarkmapCompositeEditorState) {
            currentMode = state.viewMode
            textEditor.setState(state.textState)
            updateLayout()
        }
    }

    @NotNull
    override fun getState(level: FileEditorStateLevel): FileEditorState {
        return MarkmapCompositeEditorState(currentMode, textEditor.getState(level))
    }

    override fun isModified(): Boolean = textEditor.isModified
    override fun isValid(): Boolean = textEditor.isValid

    override fun addPropertyChangeListener(listener: PropertyChangeListener) {
        textEditor.addPropertyChangeListener(listener)
    }

    override fun removePropertyChangeListener(listener: PropertyChangeListener) {
        textEditor.removePropertyChangeListener(listener)
    }

    @Nullable
    override fun getCurrentLocation(): FileEditorLocation? = textEditor.currentLocation

    @NotNull
    override fun getFile(): VirtualFile = textEditor.file

    override fun dispose() {
        disposed = true
        Disposer.dispose(resources)
        previewComponent.dispose()
        Disposer.dispose(textEditor)
    }
}

data class MarkmapCompositeEditorState(
    val viewMode: MarkmapCompositeEditor.ViewMode,
    val textState: FileEditorState
) : FileEditorState {
    override fun canBeMergedWith(otherState: FileEditorState, level: FileEditorStateLevel): Boolean {
        return otherState is MarkmapCompositeEditorState &&
                textState.canBeMergedWith(otherState.textState, level)
    }
}
