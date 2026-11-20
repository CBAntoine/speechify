// Starts Node.js (nodejs-mobile's libnode.so) with Patch's server, inside the app's own process.
// What Node prints goes to Android's log, tagged "Patch".
#include <jni.h>
#include <android/log.h>
#include <pthread.h>
#include <unistd.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

namespace node {
int Start(int argc, char* argv[]);
}

namespace {

int out_pipe[2];

void* pump_log(void*) {
    char buf[1024];
    std::string line;
    ssize_t n;
    while ((n = read(out_pipe[0], buf, sizeof buf)) > 0) {
        line.append(buf, static_cast<size_t>(n));
        size_t nl;
        while ((nl = line.find('\n')) != std::string::npos) {
            __android_log_write(ANDROID_LOG_INFO, "Patch", line.substr(0, nl).c_str());
            line.erase(0, nl + 1);
        }
        if (line.size() > 4000) {  // a very long line without a newline
            __android_log_write(ANDROID_LOG_INFO, "Patch", line.c_str());
            line.clear();
        }
    }
    return nullptr;
}

void send_output_to_log() {
    setvbuf(stdout, nullptr, _IOLBF, 0);
    setvbuf(stderr, nullptr, _IONBF, 0);
    if (pipe(out_pipe) != 0) return;
    dup2(out_pipe[1], STDOUT_FILENO);
    dup2(out_pipe[1], STDERR_FILENO);
    pthread_t t;
    if (pthread_create(&t, nullptr, pump_log, nullptr) == 0) pthread_detach(t);
}

}  // namespace

extern "C" JNIEXPORT jint JNICALL
Java_app_patch_home_PatchServer_startNode(JNIEnv* env, jclass, jobjectArray args) {
    const jsize argc = env->GetArrayLength(args);
    std::vector<std::string> parts;
    size_t total = 0;
    for (jsize i = 0; i < argc; i++) {
        auto s = static_cast<jstring>(env->GetObjectArrayElement(args, i));
        const char* chars = env->GetStringUTFChars(s, nullptr);
        parts.emplace_back(chars);
        env->ReleaseStringUTFChars(s, chars);
        env->DeleteLocalRef(s);
        total += parts.back().size() + 1;
    }
    // Node expects its arguments in one contiguous block of memory (it may reuse it for the process title).
    char* block = static_cast<char*>(calloc(total, 1));
    char** argv = static_cast<char**>(calloc(static_cast<size_t>(argc) + 1, sizeof(char*)));
    char* p = block;
    for (jsize i = 0; i < argc; i++) {
        memcpy(p, parts[i].c_str(), parts[i].size());
        argv[i] = p;
        p += parts[i].size() + 1;
    }
    send_output_to_log();
    return node::Start(argc, argv);
}
