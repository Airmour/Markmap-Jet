package com.airmour.markmap.ui

import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.application.ApplicationManager

@Service(Service.Level.APP)
@State(name = "MarkmapSettings", storages = [Storage("markmap.xml")])
class MarkmapSettings : PersistentStateComponent<MarkmapSettings.Values> {
    data class Values(var options: String = "{}", var customCss: String = "")
    private var values = Values()
    override fun getState(): Values = values
    override fun loadState(state: Values) { values = state }
    companion object {
        fun getInstance(): MarkmapSettings = ApplicationManager.getApplication().getService(MarkmapSettings::class.java)
    }
}
