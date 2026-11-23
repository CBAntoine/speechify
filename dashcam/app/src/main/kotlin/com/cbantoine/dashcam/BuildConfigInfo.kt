package com.cbantoine.dashcam

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build

object BuildConfigInfo {
    fun versionName(context: Context): String = runCatching {
        val packageManager = context.packageManager
        val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            packageManager.getPackageInfo(context.packageName, PackageManager.PackageInfoFlags.of(0))
        } else {
            @Suppress("DEPRECATION")
            packageManager.getPackageInfo(context.packageName, 0)
        }
        info.versionName.orEmpty()
    }.getOrDefault("")
}
