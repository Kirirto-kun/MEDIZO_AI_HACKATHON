# Direct Android APK release

The Android button on `/download` is fail-closed. It is enabled only when the
versioned APK exists and all five release variables are valid:

```dotenv
NEXT_PUBLIC_ANDROID_APP_URL="https://docjob.kz/downloads/android/docjob-android-1.1.2-4.apk"
ANDROID_APP_VERSION="1.1.2"
ANDROID_APP_VERSION_CODE="4"
ANDROID_APP_SHA256="<64 lowercase hex characters>"
ANDROID_APP_SIZE_BYTES="<exact byte count>"
```

For release `1.1.2 (4)`, upload the signed APK atomically to
`/srv/docjob/releases/android/docjob-android-1.1.2-4.apk`, owned by root and
mode `0644`. Keep the signing keystore off the server and never overwrite a
published versioned file. Calculate the byte count and SHA-256 from the exact
artifact before setting the environment values, then verify the remote file
has the same checksum.

Install `deploy/nginx/docjob.conf` after replacing the example domain, run
`nginx -t`, and reload Nginx. Rebuild the `web` image after changing
`NEXT_PUBLIC_ANDROID_APP_URL`; the other `ANDROID_APP_*` values are read by the
server-rendered page at runtime.

After deployment, verify:

```bash
curl -fsSI https://docjob.kz/downloads/android/docjob-android-1.1.2-4.apk
curl -fsS -H 'Range: bytes=0-1023' \
  https://docjob.kz/downloads/android/docjob-android-1.1.2-4.apk -o /tmp/docjob-range.bin
curl -fsS https://docjob.kz/downloads/android/docjob-android-1.1.2-4.apk \
  -o /tmp/docjob-android-1.1.2-4.apk
sha256sum /tmp/docjob-android-1.1.2-4.apk
curl -o /dev/null -sS -w '%{http_code}\n' \
  https://docjob.kz/downloads/android/unknown.apk
```

The first response must include the APK MIME type, attachment filename,
immutable cache policy and security headers. The range request must return
`206` with exactly 1024 bytes, the full download checksum must match the page,
and an unknown filename must return `404`.
