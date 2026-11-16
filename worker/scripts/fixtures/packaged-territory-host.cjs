const {app,BrowserWindow}=require('electron');const path=require('node:path');const {pathToFileURL}=require('node:url');
app.setPath('userData',process.env.PACKAGED_TEST_PROFILE);
app.whenReady().then(async()=>{
 const assets=process.env.PACKAGED_TEST_ASSETS;
 const win=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{preload:path.join(assets,'preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false}});
 win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>callback({cancel:true}));
 const {openTerritorySession}=await import(pathToFileURL(path.join(process.env.PACKAGED_TEST_ROOT,'dist-desktop/territory/session.js')).href);
 const session=await openTerritorySession({profileDirectory:path.join(process.env.PACKAGED_TEST_PROFILE,'territory'),assetDirectory:assets,live:false,contents:win.webContents,parent:win,integrated:true});
 app.on('before-quit',()=>{void session.close();});
 await win.loadFile(path.join(assets,'renderer/index.html'));
});app.on('window-all-closed',()=>app.quit());
