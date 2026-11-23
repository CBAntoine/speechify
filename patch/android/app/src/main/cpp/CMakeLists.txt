# The bridge between the app and Node.js: starts Patch's server on a thread inside the app,
# and sends what it prints to Android's log (adb logcat -s Patch).
cmake_minimum_required(VERSION 3.18)
project(patchbridge CXX)

set(LIBNODE ${CMAKE_CURRENT_SOURCE_DIR}/../../../libnode)

add_library(node SHARED IMPORTED)
set_target_properties(node PROPERTIES IMPORTED_LOCATION ${LIBNODE}/bin/${ANDROID_ABI}/libnode.so)

add_library(patchbridge SHARED patchbridge.cpp)
find_library(log-lib log)
target_link_libraries(patchbridge node ${log-lib})
# Phones with 16 KB memory pages (Android 15 and later) need this.
target_link_options(patchbridge PRIVATE "-Wl,-z,max-page-size=16384")
