plugins { id("com.android.application") }
android {
    namespace = "com.lancastersolutions.serviceflow"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.lancastersolutions.serviceflow"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0-pilot"
        buildConfigField("String", "DEFAULT_API_URL", "\"\"")
    }
    buildFeatures { buildConfig = true }
    buildTypes { debug { applicationIdSuffix = ".pilot"; versionNameSuffix = "-debug" } }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
}
dependencies {
    implementation("androidx.core:core:1.17.0")
    implementation("androidx.webkit:webkit:1.14.0")
}
