#!/bin/bash
set -e

APP_NAME="DanceChartMaker"
PACKAGE_PATH="com/danceexercise/chartmaker"

AAPT="/usr/bin/aapt"
DX="/usr/lib/android-sdk/build-tools/debian/dx"
ANDROID_JAR="/usr/lib/android-sdk/platforms/android-23/android.jar"
ZIPALIGN="/usr/bin/zipalign"
APKSIGNER="/usr/bin/apksigner"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

rm -rf build
mkdir -p build/gen build/classes build/dex build/apk

echo "=== R.java ==="
$AAPT package -f -m -J build/gen -S res -M AndroidManifest.xml -I "$ANDROID_JAR"

echo "=== compile ==="
javac -source 1.8 -target 1.8 \
    -classpath "$ANDROID_JAR" \
    -sourcepath "src:build/gen" \
    -d build/classes \
    src/$PACKAGE_PATH/*.java \
    build/gen/$PACKAGE_PATH/R.java

echo "=== dex ==="
$DX --dex --output=build/dex/classes.dex build/classes

echo "=== package ==="
$AAPT package -f -M AndroidManifest.xml -S res -A assets -I "$ANDROID_JAR" \
    -F build/apk/${APP_NAME}-unsigned.apk

cd build/apk
jar uf ${APP_NAME}-unsigned.apk -C ../dex classes.dex
cd "$SCRIPT_DIR"

echo "=== align ==="
$ZIPALIGN -f 4 build/apk/${APP_NAME}-unsigned.apk build/apk/${APP_NAME}-aligned.apk

echo "=== keystore ==="
if [ ! -f build/debug.keystore ]; then
    keytool -genkeypair -v -keystore build/debug.keystore \
        -alias key -keyalg RSA -keysize 2048 -validity 10000 \
        -storepass android -keypass android \
        -dname "CN=Dance Chart Maker,O=Local,C=US"
fi

echo "=== sign ==="
$APKSIGNER sign --ks build/debug.keystore --ks-key-alias key \
    --ks-pass pass:android --key-pass pass:android \
    --out build/apk/${APP_NAME}.apk \
    build/apk/${APP_NAME}-aligned.apk

echo "=== done ==="
ls -lh build/apk/${APP_NAME}.apk
