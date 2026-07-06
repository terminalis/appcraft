import type { AppModel } from "@appcraft-io/core";
import { safeName } from "./naming.js";
import type { Uses } from "./uses.js";

/**
 * Gradle project scaffold. Versions are pinned per compiler release — the
 * toolchain-churn mitigation: a given compiler version always emits the same,
 * known-good build configuration.
 */

export const PINS = {
  agp: "8.7.3",
  kotlin: "2.0.21",
  ksp: "2.0.21-1.0.25",
  composeBom: "2024.10.00",
  activityCompose: "1.9.3",
  navigationCompose: "2.8.3",
  room: "2.6.1",
  coil: "2.7.0",
  coreKtx: "1.15.0",
  lifecycle: "2.8.7",
  compileSdk: 35,
  minSdk: 26,
  targetSdk: 35,
  jvmTarget: "17",
} as const;

export function emitProject(model: AppModel, uses: Uses, files: Map<string, string>): void {
  const app = safeName(model.app.name);
  const pkg = model.app.package;
  const seed = model.theme?.seedColor ?? "#3F51B5";

  files.set(
    "settings.gradle.kts",
    `pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "${app}"
include(":app")
`,
  );

  files.set(
    "build.gradle.kts",
    `plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false${uses.room ? "\n    alias(libs.plugins.ksp) apply false" : ""}
}
`,
  );

  files.set(
    "gradle.properties",
    `org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
android.useAndroidX=true
android.nonTransitiveRClass=true
kotlin.code.style=official
`,
  );

  files.set(
    "gradle/libs.versions.toml",
    `[versions]
agp = "${PINS.agp}"
kotlin = "${PINS.kotlin}"
ksp = "${PINS.ksp}"
composeBom = "${PINS.composeBom}"
activityCompose = "${PINS.activityCompose}"
navigationCompose = "${PINS.navigationCompose}"
room = "${PINS.room}"
coil = "${PINS.coil}"
coreKtx = "${PINS.coreKtx}"
lifecycle = "${PINS.lifecycle}"

[libraries]
androidx-core-ktx = { group = "androidx.core", name = "core-ktx", version.ref = "coreKtx" }
androidx-lifecycle-runtime-ktx = { group = "androidx.lifecycle", name = "lifecycle-runtime-ktx", version.ref = "lifecycle" }
androidx-lifecycle-viewmodel-compose = { group = "androidx.lifecycle", name = "lifecycle-viewmodel-compose", version.ref = "lifecycle" }
androidx-activity-compose = { group = "androidx.activity", name = "activity-compose", version.ref = "activityCompose" }
androidx-compose-bom = { group = "androidx.compose", name = "compose-bom", version.ref = "composeBom" }
androidx-compose-ui = { group = "androidx.compose.ui", name = "ui" }
androidx-compose-ui-graphics = { group = "androidx.compose.ui", name = "ui-graphics" }
androidx-compose-material3 = { group = "androidx.compose.material3", name = "material3" }
androidx-compose-material-icons = { group = "androidx.compose.material", name = "material-icons-extended" }
androidx-navigation-compose = { group = "androidx.navigation", name = "navigation-compose", version.ref = "navigationCompose" }
androidx-room-runtime = { group = "androidx.room", name = "room-runtime", version.ref = "room" }
androidx-room-ktx = { group = "androidx.room", name = "room-ktx", version.ref = "room" }
androidx-room-compiler = { group = "androidx.room", name = "room-compiler", version.ref = "room" }
coil-compose = { group = "io.coil-kt", name = "coil-compose", version.ref = "coil" }

[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
kotlin-android = { id = "org.jetbrains.kotlin.android", version.ref = "kotlin" }
kotlin-compose = { id = "org.jetbrains.kotlin.plugin.compose", version.ref = "kotlin" }
ksp = { id = "com.google.devtools.ksp", version.ref = "ksp" }
`,
  );

  const roomDeps = uses.room
    ? `
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)`
    : "";
  const coilDep = uses.image
    ? `
    implementation(libs.coil.compose)`
    : "";

  files.set(
    "app/build.gradle.kts",
    `plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)${uses.room ? "\n    alias(libs.plugins.ksp)" : ""}
}

android {
    namespace = "${pkg}"
    compileSdk = ${PINS.compileSdk}

    defaultConfig {
        applicationId = "${pkg}"
        minSdk = ${PINS.minSdk}
        targetSdk = ${PINS.targetSdk}
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "${PINS.jvmTarget}"
    }
    buildFeatures {
        compose = true
    }
}

dependencies {
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons)
    implementation(libs.androidx.navigation.compose)${roomDeps}${coilDep}
}
`,
  );

  files.set("app/proguard-rules.pro", `# AppCraft: no additional rules required for 0.1 output.\n`);

  // Permissions are derived exclusively from model capabilities. v0.1 output
  // needs none: images use the permissionless Android Photo Picker.
  // Secure defaults: on-device data (often health-adjacent) must not silently
  // leave the device — backups and D2D transfer are disabled (allowBackup for
  // API <31, dataExtractionRules for 31+), and cleartext HTTP is refused even
  // on Android 8.x where the platform would otherwise permit it (S6358, S5332).
  files.set(
    "app/src/main/AndroidManifest.xml",
    `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">

    <application
        android:allowBackup="false"
        android:dataExtractionRules="@xml/data_extraction_rules"
        android:label="@string/app_name"
        android:icon="@mipmap/ic_launcher"
        android:supportsRtl="true"
        android:usesCleartextTraffic="false"
        android:theme="@style/Theme.${app}"
        tools:targetApi="31">
        <activity
            android:name=".MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>

</manifest>
`,
  );

  files.set(
    "app/src/main/res/xml/data_extraction_rules.xml",
    `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
    <cloud-backup>
        <exclude domain="root" path="." />
        <exclude domain="file" path="." />
        <exclude domain="database" path="." />
        <exclude domain="sharedpref" path="." />
        <exclude domain="external" path="." />
    </cloud-backup>
    <device-transfer>
        <exclude domain="root" path="." />
        <exclude domain="file" path="." />
        <exclude domain="database" path="." />
        <exclude domain="sharedpref" path="." />
        <exclude domain="external" path="." />
    </device-transfer>
</data-extraction-rules>
`,
  );

  files.set(
    "app/src/main/res/values/strings.xml",
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">${model.app.name}</string>
</resources>
`,
  );

  files.set(
    "app/src/main/res/values/themes.xml",
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="Theme.${app}" parent="android:Theme.Material.Light.NoActionBar" />
</resources>
`,
  );

  files.set(
    "app/src/main/res/values/colors.xml",
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${seed}</color>
</resources>
`,
  );

  files.set(
    "app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml",
    `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>
`,
  );

  files.set(
    "app/src/main/res/drawable/ic_launcher_foreground.xml",
    `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M54,32 A22,22 0 1,0 54,76 A22,22 0 1,0 54,32 Z M54,42 A12,12 0 1,1 54,66 A12,12 0 1,1 54,42 Z" />
</vector>
`,
  );
}
