import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.dsl.KotlinVersion
import org.jetbrains.kotlin.gradle.tasks.KotlinJvmCompile
import java.util.Properties
import org.jetbrains.intellij.platform.gradle.IntelliJPlatformType

fun properties(key: String) = providers.gradleProperty(key)

plugins {
    id("java")
    alias(libs.plugins.kotlin)
    alias(libs.plugins.intellijPlatform)
}

group = properties("pluginGroup").get()
version = properties("pluginVersion").get()

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        val localPlatform = providers.gradleProperty("platformLocalPath").orNull
        if (localPlatform.isNullOrBlank()) {
            create {
                type = properties("platformType").map { IntelliJPlatformType.fromCode(it) }
                version = properties("platformVersion")
                useInstaller = false
            }
        } else {
            local(localPlatform)
        }
        jetbrainsRuntime()
        bundledPlugins(properties("platformBundledPlugins").map { it.split(',') })
        pluginVerifier()
        zipSigner()
    }
}

intellijPlatform {
    buildSearchableOptions = false

    pluginConfiguration {
        version = properties("pluginVersion")

        ideaVersion {
            sinceBuild = properties("pluginSinceBuild")
            untilBuild = properties("pluginUntilBuild")
        }
    }

    signing {
        certificateChain = providers.environmentVariable("CERTIFICATE_CHAIN")
        privateKey = providers.environmentVariable("PRIVATE_KEY")
        password = providers.environmentVariable("PRIVATE_KEY_PASSWORD")
    }

    publishing {
        token = providers.environmentVariable("PUBLISH_TOKEN").orElse(
            providers.fileContents(layout.projectDirectory.file("local.properties")).asText.map { content ->
                Properties().apply { load(content.reader()) }.getProperty("publishToken", "")
            }
        )
        channels = properties("pluginVersion").map { listOf(it.substringAfter('-', "").substringBefore('.').ifEmpty { "default" }) }
    }

    pluginVerification {
        ides {
            val localIdes = providers.gradleProperty("verificationIdePaths").orNull
            if (localIdes.isNullOrBlank()) {
                recommended()
            } else {
                localIdes.split('|').forEach { local(it) }
            }
        }
    }
}

tasks {
    wrapper {
        gradleVersion = libs.versions.gradle.get()
    }

}

java {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}

tasks.withType<JavaCompile>().configureEach {
    options.release = 21
}

kotlin {
    jvmToolchain(25)
    compilerOptions {
        jvmTarget = JvmTarget.JVM_21
        // Compile with the installed JDK while restricting Java and Kotlin APIs to the baseline IDE.
        freeCompilerArgs.add("-Xjdk-release=21")
        apiVersion = KotlinVersion.KOTLIN_2_2
        languageVersion = KotlinVersion.KOTLIN_2_2
    }
}

tasks.withType<KotlinJvmCompile>().configureEach {
    compilerOptions.jvmTarget = JvmTarget.JVM_21
}
