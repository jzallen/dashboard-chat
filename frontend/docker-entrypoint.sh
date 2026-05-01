#!/bin/sh
# Frontend container entrypoint shim.
#
# 1. Reads /etc/dashboard-chat/version.json (planted by the Bazel
#    `version_layer` macro) and emits a single canonical identity line on
#    stdout — same format as the server-process services.
# 2. Copies the same file to /usr/share/nginx/html/_meta.json so that
#    `curl http://<host>/_meta.json` returns the build identity (Story 2 /
#    AC2.2 of dc-1k8).
# 3. Exec's nginx so it remains PID 1.
#
# Graceful degradation (AC1.5): if version.json is missing or unparseable, log
# "unknown" tokens, write a best-effort fallback to /_meta.json, and start
# nginx anyway.
set -eu

SERVICE="dashboard-frontend"
VERSION_FILE="/etc/dashboard-chat/version.json"
META_FILE="/usr/share/nginx/html/_meta.json"
UNKNOWN="unknown"

image="$UNKNOWN"
sha="$UNKNOWN"
built="$UNKNOWN"
dirty="false"

# Tiny field extractor: pulls "key": "value" or "key": value from a JSON object.
# Tolerates absent fields by defaulting to "unknown" / false.
if [ -r "$VERSION_FILE" ]; then
    raw_image=$(sed -n 's/.*"image"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$VERSION_FILE" | head -n1)
    raw_sha=$(sed -n 's/.*"sha"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$VERSION_FILE" | head -n1)
    raw_built=$(sed -n 's/.*"built"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$VERSION_FILE" | head -n1)
    raw_dirty=$(sed -n 's/.*"dirty"[[:space:]]*:[[:space:]]*\(true\|false\).*/\1/p' "$VERSION_FILE" | head -n1)
    [ -n "$raw_image" ] && image="$raw_image"
    [ -n "$raw_sha" ] && sha="$raw_sha"
    [ -n "$raw_built" ] && built="$raw_built"
    [ -n "$raw_dirty" ] && dirty="$raw_dirty"
fi

# 7-char SHA in the stdout line; full SHA stays in the JSON payload.
if [ "$sha" = "$UNKNOWN" ]; then
    short_sha="$UNKNOWN"
    dirty_marker=""
else
    short_sha=$(printf %s "$sha" | cut -c1-7)
    if [ "$dirty" = "true" ]; then
        dirty_marker="+dirty"
    else
        dirty_marker=""
    fi
fi

printf '%s image=%s sha=%s%s built=%s\n' \
    "$SERVICE" "$image" "$short_sha" "$dirty_marker" "$built"

# Publish the JSON payload at /_meta.json for HTTP consumers (AC2.2). Build it
# from the values just parsed (or "unknown" fallbacks) rather than cp'ing the
# source — a /dev/null override would otherwise produce an empty /_meta.json
# instead of a graceful-degradation JSON document (AC1.5).
mkdir -p "$(dirname "$META_FILE")"
cat > "$META_FILE" <<EOF
{"image":"$image","sha":"$sha","dirty":$dirty,"built":"$built"}
EOF

exec nginx -g 'daemon off;'
