import { appOrigin } from '@/lib/routing/app-url'

export const SCREENSHOT_WIDGET_URI = 'ui://applistingagent/screenshots-v1.html'
const MIME = 'text/html;profile=mcp-app'
const ASSET_ORIGIN = 'https://screens.appstorecopilot.com'

/** No customer strings are interpolated into HTML; only textContent and validated URLs. */
export const SCREENSHOT_WIDGET_HTML = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light dark;font-family:system-ui,sans-serif}*{box-sizing:border-box}
body{margin:0;padding:0;color:light-dark(#202124,#eee);background:transparent}
#gallery-workspace{padding:calc(16px + var(--safe-top,0px)) calc(16px + var(--safe-right,0px)) calc(16px + var(--safe-bottom,0px)) calc(16px + var(--safe-left,0px))}
h1{font-size:18px;margin:0 0 8px}p{font-size:13px;line-height:1.5}
#gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:16px}
figure{margin:0;min-width:0}img{display:block;width:100%;height:min(560px,75vh);object-fit:contain;background:light-dark(#f4f4f4,#252525);border-radius:8px}
figcaption{overflow-wrap:anywhere;font-size:13px;margin:8px 0}
a{display:inline-block;padding:8px 0;color:light-dark(#4130a8,#b8abff)}a:focus-visible{outline:2px solid currentColor}
</style></head><body><main id="gallery-workspace"><h1>Saved screenshots</h1><p id="status" role="status">Loading saved screenshots…</p>
<div id="gallery"></div><p>Saved local drafts. Nothing is published by viewing or opening these images.</p></main>
<script>
const gallery=document.getElementById('gallery'),status=document.getElementById('status');
let nextId=1,initialized=false;const pending=new Map();
function request(method,params){return new Promise((resolve,reject)=>{const id=nextId++;pending.set(id,{resolve,reject});window.parent.postMessage({jsonrpc:'2.0',id,method,params},'*');});}
function notify(method,params){window.parent.postMessage({jsonrpc:'2.0',method,params},'*');}
function resize(){requestAnimationFrame(()=>notify('ui/notifications/size-changed',{width:Math.ceil(window.innerWidth),height:Math.ceil(document.body.getBoundingClientRect().height)}));}
function asset(value){if(typeof value!=='string'||value.length>4096)return null;try{const u=new URL(value);return u.origin==='${ASSET_ORIGIN}'&&u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&/\\.(?:png|jpe?g|webp)$/i.test(u.pathname)?u.href:null;}catch{return null;}}
function text(value){return typeof value==='string'?value.slice(0,300):'';}
function device(value){const names={APP_IPHONE_69:'iPhone 6.9-inch',APP_IPHONE_67:'iPhone 6.7-inch',APP_IPHONE_65:'iPhone 6.5-inch',APP_IPHONE_63:'iPhone 6.3-inch',APP_IPHONE_61:'iPhone 6.1-inch',APP_IPHONE_55:'iPhone 5.5-inch',APP_IPAD_PRO_13:'iPad 13-inch',APP_IPAD_PRO_129:'iPad Pro 12.9-inch',APP_IPAD_PRO_3GEN_129:'iPad Pro 12.9-inch',APP_IPAD_PRO_11:'iPad Pro 11-inch',APP_WATCH_ULTRA_3:'Apple Watch Ultra 3',APP_WATCH_ULTRA:'Apple Watch Ultra',APP_WATCH_SERIES_10:'Apple Watch Series 10/11',APP_WATCH_SERIES_7:'Apple Watch Series 7–9',APP_WATCH_SERIES_4:'Apple Watch Series 4–6 / SE',APP_WATCH_SERIES_3:'Apple Watch Series 3',PLAY_PHONE:'Android phone',PLAY_TABLET:'Android tablet',PLAY_FEATURE_GRAPHIC:'Google Play feature graphic'};return Object.prototype.hasOwnProperty.call(names,value)?names[value]:'Screenshot draft';}
function language(value){if(value==='en-US')return 'English (US)';if(value==='primary')return 'Primary language';if(typeof value!=='string'||value.length>35)return '';try{return new Intl.DisplayNames(['en'],{type:'language',fallback:'none'}).of(value)||'';}catch{return '';}}

function clear(message){gallery.replaceChildren();status.textContent=message;resize();}
function render(result){
 clear('No supported saved screenshots found.');
 const data=result?.structuredContent;
 if(result?.isError||!data||data.success!==true||!Array.isArray(data.sets)){clear('Saved screenshots unavailable. Ask the assistant to retrieve them again.');return;}
 let count=0;
 for(const set of data.sets.slice(0,30)){
  if(!set||!Array.isArray(set.screenshots))continue;
  for(const item of set.screenshots.slice(0,30)){
   if(count>=60)break;
   const url=asset(item?.imageUrl);if(!url)continue;
   const figure=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption'),link=document.createElement('a');
   img.src=url;img.alt=text(item.headline)||'Saved screenshot';img.referrerPolicy='no-referrer';
   img.onload=resize;img.onerror=()=>{img.remove();caption.textContent+=' — Preview unavailable; try opening the saved image.';resize();};
   caption.textContent=[device(set.displayType),language(set.locale),text(item.headline)].filter(Boolean).join(' · ');
   link.href=url;link.textContent='Open saved image';link.rel='noopener noreferrer';link.target='_blank';
   link.onclick=async event=>{event.preventDefault();if(!gallery.contains(link))return;try{
    if(typeof window.openai?.openExternal==='function')await window.openai.openExternal({href:url});
    else if(initialized)await request('ui/open-link',{url});
    else throw new Error('Host unavailable');
   }catch{status.textContent='The host could not open the saved image. Use the image URL returned by the tool.';resize();}};
   figure.append(img,caption,link);gallery.append(figure);count++;
  }
 }
 status.textContent=count?count+' saved screenshot'+(count===1?'':'s')+' shown.':'No supported saved screenshots found.';resize();
}
function context(value){
 if(value?.theme==='light'||value?.theme==='dark')document.documentElement.style.colorScheme=value.theme;
 if(value&&Object.prototype.hasOwnProperty.call(value,'safeAreaInsets')){
  for(const edge of ['top','right','bottom','left']){const inset=value.safeAreaInsets?.[edge];document.documentElement.style.setProperty('--safe-'+edge,(typeof inset==='number'&&Number.isFinite(inset)&&inset>=0?inset:0)+'px');}
 }resize();
}
window.addEventListener('message',event=>{
 if(event.source!==window.parent)return;const m=event.data;if(!m||m.jsonrpc!=='2.0')return;
 if(!Object.prototype.hasOwnProperty.call(m,'method')&&(Object.prototype.hasOwnProperty.call(m,'result')||Object.prototype.hasOwnProperty.call(m,'error'))&&m.id!==undefined&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);return;}
 if(m.method==='ping'&&m.id!==undefined){window.parent.postMessage({jsonrpc:'2.0',id:m.id,result:{}},'*');return;}
 if(m.method==='ui/notifications/tool-result')render(m.params);
 else if(m.method==='ui/notifications/tool-input'||m.method==='ui/notifications/tool-cancelled')clear('Loading saved screenshots…');
 else if(m.method==='ui/notifications/host-context-changed')context(m.params);
});
request('ui/initialize',{appInfo:{name:'App Listing Agent saved screenshots',version:'1.0.0'},appCapabilities:{availableDisplayModes:['inline']},protocolVersion:'2026-01-26'}).then(result=>{initialized=true;context(result?.hostContext);notify('ui/notifications/initialized',{});resize();}).catch(()=>clear('Could not connect the screenshot gallery to the host.'));
</script></body></html>`

export function getScreenshotWidgetResource() {
  return { uri: SCREENSHOT_WIDGET_URI, name: 'App Listing Agent saved screenshots', description: 'Existing screenshot previews and image links.', mimeType: MIME }
}

export function readScreenshotWidgetResource(profile?: 'claude') {
  return { contents: [{ uri: SCREENSHOT_WIDGET_URI, mimeType: MIME, text: SCREENSHOT_WIDGET_HTML, _meta: {
    ui: { prefersBorder: true, ...(profile === 'claude' ? {} : { domain: appOrigin() }), csp: { connectDomains: [], resourceDomains: [ASSET_ORIGIN] } },
    'openai/widgetDescription': 'Displays existing saved screenshot previews and links. Rendering does not establish assistant visual inspection or store publication.',
    'openai/widgetPrefersBorder': true,
    'openai/widgetDomain': appOrigin(),
    'openai/widgetCSP': { connect_domains: [], resource_domains: [ASSET_ORIGIN], redirect_domains: [ASSET_ORIGIN] },
  } }] }
}
