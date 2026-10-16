#!/usr/bin/env bash
# A test-only GLFW 3.4 fixture; Steam Frame supplies its own GLFW at runtime.
set -euo pipefail
work="$PWD/dist/glfw-fixture"
mkdir -p "$work"
curl -fL --retry 3 https://codeload.github.com/glfw/glfw/tar.gz/refs/tags/3.4 -o "$work/glfw.tar.gz"
printf '%s  %s\n' c038d34200234d071fae9345bc455e4a8f2f544ab60150765d7704e08f3dac01 "$work/glfw.tar.gz" | sha256sum -c -
tar -xf "$work/glfw.tar.gz" -C "$work"
cmake -S "$work/glfw-3.4" -B "$work/build" \
  -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=ON \
  -DGLFW_BUILD_WAYLAND=OFF -DGLFW_BUILD_X11=ON \
  -DGLFW_BUILD_EXAMPLES=OFF -DGLFW_BUILD_TESTS=OFF -DGLFW_BUILD_DOCS=OFF \
  -DCMAKE_INSTALL_PREFIX="$work/usr" -DCMAKE_INSTALL_LIBDIR=lib
cmake --build "$work/build" --parallel 2
cmake --install "$work/build"
