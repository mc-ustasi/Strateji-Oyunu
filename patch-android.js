// Android projesini yatay (landscape) moda kilitler ve tam ekran görünüm ayarlar.
// "npx cap add android" komutundan SONRA çalıştırın.
const fs = require('fs');
const path = require('path');

const manifest = path.join('android', 'app', 'src', 'main', 'AndroidManifest.xml');
if (!fs.existsSync(manifest)) {
  console.error('AndroidManifest.xml bulunamadı. Önce "npx cap add android" çalıştırın.');
  process.exit(1);
}
let xml = fs.readFileSync(manifest, 'utf8');
if (/android:screenOrientation=/.test(xml)) {
  xml = xml.replace(/android:screenOrientation="[^"]*"/, 'android:screenOrientation="sensorLandscape"');
} else {
  xml = xml.replace('<activity', '<activity\n            android:screenOrientation="sensorLandscape"');
}
fs.writeFileSync(manifest, xml);
console.log('✔ Ekran yönü: sensorLandscape');

const styles = path.join('android', 'app', 'src', 'main', 'res', 'values', 'styles.xml');
if (fs.existsSync(styles)) {
  let s = fs.readFileSync(styles, 'utf8');
  if (!/windowFullscreen/.test(s)) {
    s = s.replace(/(<style name="AppTheme.NoActionBar"[^>]*>)/,
      '$1\n        <item name="android:windowFullscreen">true</item>');
    fs.writeFileSync(styles, s);
    console.log('✔ Tam ekran teması eklendi.');
  }
}
