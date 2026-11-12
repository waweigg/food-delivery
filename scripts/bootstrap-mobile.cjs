const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../apps/mobile');
const files=['pubspec.yaml','analysis_options.yaml','lib/main.dart','test/widget_test.dart'];
const originals=files.map(name=>[name,fs.readFileSync(path.join(root,name))]);
let result;
try {
 result=spawnSync(process.platform==='win32'?'flutter.bat':'flutter', ['create','--platforms=android,ios','--org','com.example','--project-name','food_delivery','.'],{cwd:root,stdio:'inherit',shell:process.platform==='win32'});
} finally { for(const [name,data] of originals) fs.writeFileSync(path.join(root,name),data); }
if(result?.error) console.error(result.error.message);
if(result?.status!==0) process.exit(1);
const manifest=path.join(root,'android/app/src/main/AndroidManifest.xml');
let xml=fs.readFileSync(manifest,'utf8');
xml=xml.replace(/android:label="[^"]*"/, 'android:label="waweigg"');
if(!xml.includes('android.permission.INTERNET')) xml=xml.replace('<application','<uses-permission android:name="android.permission.INTERNET"/>\n    <application');
fs.writeFileSync(manifest,xml);
for(const permission of ['ACCESS_COARSE_LOCATION','ACCESS_FINE_LOCATION']) {
 if(!xml.includes('android.permission.'+permission)) xml=xml.replace('<application',`<uses-permission android:name="android.permission.${permission}"/>\n    <application`);
}
fs.writeFileSync(manifest,xml);
const plist=path.join(root,'ios/Runner/Info.plist');
let ios=fs.readFileSync(plist,'utf8');
if(!ios.includes('NSPhotoLibraryUsageDescription')) {
 const end=ios.lastIndexOf('</dict>');
 if(end<0) throw new Error('Invalid iOS Info.plist');
 ios=ios.slice(0,end)+'<key>NSPhotoLibraryUsageDescription</key>\n<string>Select a photo for a restaurant menu item.</string>\n'+ios.slice(end);
}
if(!ios.includes('NSLocationWhenInUseUsageDescription')) {
 const end=ios.lastIndexOf('</dict>');
 ios=ios.slice(0,end)+'<key>NSLocationWhenInUseUsageDescription</key>\n<string>Use your location to find restaurants serving your delivery address. Drivers can also share location while online to receive and fulfil deliveries.</string>\n'+ios.slice(end);
}
ios=ios.replace(/(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/,'$1waweigg$2');
fs.writeFileSync(plist,ios);
console.log('Native projects generated. Run flutter pub get, dart run flutter_launcher_icons, flutter analyze and flutter test. Replace com.example before release.');

