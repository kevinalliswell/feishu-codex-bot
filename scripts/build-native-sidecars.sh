#!/bin/bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Native sidecars must be built on macOS." >&2
  exit 1
fi

FFMPEG_VERSION="9.0.1"
FFMPEG_SHA256="cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635"
WHISPER_VERSION="1.9.2"
WHISPER_SHA256="a6abd064fcca8b85e794d205abf328c522e9451db43a3eadc178b883b7d0e9cd"
TARGET_TRIPLE="aarch64-apple-darwin"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="$PROJECT_DIR/desktop/src-tauri/binaries"
BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/feishu-codex-native.XXXXXX")"
trap 'rm -rf "$BUILD_DIR"' EXIT

mkdir -p "$OUTPUT_DIR"

download_verified() {
  local url="$1"
  local destination="$2"
  local expected="$3"
  curl --fail --location --retry 3 --output "$destination" "$url"
  local actual
  actual="$(shasum -a 256 "$destination" | awk '{print $1}')"
  if [[ "$actual" != "$expected" ]]; then
    echo "Checksum mismatch for $destination" >&2
    exit 1
  fi
}

download_verified \
  "https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz" \
  "$BUILD_DIR/ffmpeg.tar.xz" \
  "$FFMPEG_SHA256"
tar -xf "$BUILD_DIR/ffmpeg.tar.xz" -C "$BUILD_DIR"
pushd "$BUILD_DIR/ffmpeg-${FFMPEG_VERSION}" >/dev/null
FFMPEG_CROSS_ARG=""
if [[ "$(uname -m)" != "arm64" ]]; then
  FFMPEG_CROSS_ARG="--enable-cross-compile"
fi
./configure \
  ${FFMPEG_CROSS_ARG:+"$FFMPEG_CROSS_ARG"} \
  --prefix="$BUILD_DIR/ffmpeg-install" \
  --arch=arm64 \
  --cc=clang \
  --disable-autodetect \
  --disable-debug \
  --disable-doc \
  --disable-everything \
  --disable-network \
  --disable-shared \
  --enable-static \
  --enable-ffmpeg \
  --enable-avcodec \
  --enable-avformat \
  --enable-avutil \
  --enable-swresample \
  --enable-protocol=file \
  --enable-protocol=pipe \
  --enable-demuxer=aac \
  --enable-demuxer=flac \
  --enable-demuxer=matroska \
  --enable-demuxer=mov \
  --enable-demuxer=mp3 \
  --enable-demuxer=ogg \
  --enable-demuxer=wav \
  --enable-decoder=aac \
  --enable-decoder=flac \
  --enable-decoder=mp3 \
  --enable-decoder=opus \
  --enable-decoder=pcm_s16le \
  --enable-decoder=pcm_s24le \
  --enable-decoder=pcm_s32le \
  --enable-decoder=vorbis \
  --enable-encoder=pcm_s16le \
  --enable-muxer=wav \
  --enable-parser=aac \
  --enable-parser=flac \
  --enable-parser=mpegaudio \
  --enable-filter=aresample \
  --extra-cflags="-mmacosx-version-min=12.0 -Os" \
  --extra-ldflags="-mmacosx-version-min=12.0"
make -j"$(sysctl -n hw.logicalcpu)" ffmpeg
cp ffmpeg "$OUTPUT_DIR/ffmpeg-${TARGET_TRIPLE}"
popd >/dev/null

download_verified \
  "https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v${WHISPER_VERSION}.tar.gz" \
  "$BUILD_DIR/whisper.tar.gz" \
  "$WHISPER_SHA256"
tar -xf "$BUILD_DIR/whisper.tar.gz" -C "$BUILD_DIR"
cmake \
  -S "$BUILD_DIR/whisper.cpp-${WHISPER_VERSION}" \
  -B "$BUILD_DIR/whisper-build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES=arm64 \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=12.0 \
  -DBUILD_SHARED_LIBS=OFF \
  -DGGML_METAL=ON \
  -DWHISPER_BUILD_EXAMPLES=ON \
  -DWHISPER_BUILD_SERVER=OFF \
  -DWHISPER_BUILD_TESTS=OFF
cmake --build "$BUILD_DIR/whisper-build" --config Release --target whisper-cli --parallel "$(sysctl -n hw.logicalcpu)"
cp "$BUILD_DIR/whisper-build/bin/whisper-cli" "$OUTPUT_DIR/whisper-cli-${TARGET_TRIPLE}"

for binary in \
  "$OUTPUT_DIR/feishu-codex-sidecar-${TARGET_TRIPLE}" \
  "$OUTPUT_DIR/ffmpeg-${TARGET_TRIPLE}" \
  "$OUTPUT_DIR/whisper-cli-${TARGET_TRIPLE}"; do
  if [[ ! -f "$binary" ]]; then
    echo "Required sidecar is missing: $binary" >&2
    exit 1
  fi
  chmod 755 "$binary"
  codesign --force --sign - "$binary"
  file "$binary" | grep -q "arm64"
  if otool -L "$binary" | tail -n +2 | awk '{print $1}' | grep -Ev '^(/usr/lib/|/System/Library/)'; then
    echo "Unexpected non-system dynamic dependency in $binary" >&2
    exit 1
  fi
done

echo "Built self-contained LGPL ffmpeg and MIT whisper.cpp sidecars in $OUTPUT_DIR"
