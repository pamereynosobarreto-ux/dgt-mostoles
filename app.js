/* DGT Móstoles GPS - PWA de entrenamiento. No es una app oficial de la DGT. */

const DGT = { lat: 40.3438889, lon: -3.8641667, name: 'Centro de Exámenes DGT Móstoles' };
const MOSTOLES = { lat: 40.3232, lon: -3.8676 };

// Puntos de entrenamiento. Son puntos de paso para generar recorridos de práctica,
// no rutas oficiales ni predicciones de examen.
const PRACTICE_POINTS = [
  {name:'Av. de Portugal', lat:40.3287, lon:-3.8745},
  {name:'Pintor Velázquez', lat:40.3311, lon:-3.8781},
  {name:'Zona Universidad', lat:40.3353, lon:-3.8721},
  {name:'Móstoles Centro', lat:40.3221, lon:-3.8654},
  {name:'Zona M-506', lat:40.3450, lon:-3.9007},
  {name:'Alcorcón Oeste', lat:40.3445, lon:-3.8398},
  {name:'Alcorcón Sur', lat:40.3310, lon:-3.8275},
  {name:'Zona industrial', lat:40.3470, lon:-3.8838}
];

let map, userMarker, accuracyCircle, routeLayer, watchId = null;
let currentPos = null;
let following = false;
let chosenMinutes = 25;
let routeSteps = [];
let examTimer = null;
let deferredPrompt = null;

const $ = (id) => document.getElementById(id);
const gpsStatus = $('gpsStatus');
const gpsDetail = $('gpsDetail');
const gpsDot = $('gpsDot');
const locateBtn = $('locateBtn');
const followBtn = $('followBtn');
const routeFromMeBtn = $('routeFromMeBtn');
const examBtn = $('examBtn');
const stopExamBtn = $('stopExamBtn');
const examInstruction = $('examInstruction');
const clearRouteBtn = $('clearRouteBtn');
const installBtn = $('installBtn');

function initMap(){
  map = L.map('map', { zoomControl: true }).setView([MOSTOLES.lat, MOSTOLES.lon], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  L.marker([DGT.lat, DGT.lon], {
    title: DGT.name
  }).addTo(map).bindPopup(`<strong>${DGT.name}</strong><br>A-5 km 16,500 · salida 14<br><small>Punto oficial de referencia.</small>`);
}

function fmtAccuracy(m){ return m < 1000 ? `${Math.round(m)} m` : `${(m/1000).toFixed(1)} km`; }

function updateUserLocation(pos){
  const { latitude, longitude, accuracy, speed, heading } = pos.coords;
  currentPos = { lat: latitude, lon: longitude, accuracy, speed, heading, ts: pos.timestamp };
  gpsStatus.textContent = 'GPS activo';
  gpsDetail.textContent = `Precisión aprox. ${fmtAccuracy(accuracy)}${speed != null && speed >= 0 ? ` · ${Math.round(speed*3.6)} km/h` : ''}`;
  gpsDot.classList.add('ok');
  followBtn.disabled = false;
  routeFromMeBtn.disabled = false;

  const ll = [latitude, longitude];
  if(!userMarker){
    userMarker = L.circleMarker(ll, {radius:8, weight:3, color:'#fff', fillColor:'#0b57d0', fillOpacity:1}).addTo(map).bindPopup('Tu ubicación GPS');
    accuracyCircle = L.circle(ll, {radius:accuracy, weight:1, color:'#0b57d0', fillOpacity:.06}).addTo(map);
    map.setView(ll, 16);
  } else {
    userMarker.setLatLng(ll);
    accuracyCircle.setLatLng(ll).setRadius(accuracy);
  }
  if(following) map.panTo(ll, {animate:true});
}

function gpsError(err){
  const msg = err.code === 1 ? 'Permiso de ubicación denegado.' : err.code === 2 ? 'No se puede obtener la ubicación.' : 'El GPS tardó demasiado.';
  gpsStatus.textContent = 'GPS no disponible';
  gpsDetail.textContent = `${msg} Revisa permisos de ubicación del navegador/app.`;
  gpsDot.classList.remove('ok');
}

function startGPS(){
  if(!('geolocation' in navigator)){
    gpsStatus.textContent = 'GPS no compatible';
    gpsDetail.textContent = 'Este dispositivo/navegador no ofrece geolocalización.';
    return;
  }
  gpsStatus.textContent = 'Buscando ubicación…';
  gpsDetail.textContent = 'Acepta el permiso de ubicación precisa del móvil.';
  if(watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(updateUserLocation, gpsError, {
    enableHighAccuracy:true,
    maximumAge:1500,
    timeout:12000
  });
}

function pickWaypoints(minutes, start){
  // Distancias aproximadas para recorridos urbanos/mixtos; el servidor de rutas ajusta después.
  const count = minutes <= 15 ? 1 : minutes <= 25 ? 2 : 3;
  const shuffled = [...PRACTICE_POINTS].sort(()=>Math.random()-.5);
  const picked = shuffled.slice(0,count);
  // Para práctica desde DGT, cerrar en DGT. Desde el usuario, termina cerca de DGT para entrenamiento orientado al examen.
  return [start, ...picked.map(p=>({lat:p.lat,lon:p.lon})), {lat:DGT.lat,lon:DGT.lon}];
}

function haversine(a,b){
  const R=6371, rad=Math.PI/180;
  const dLat=(b.lat-a.lat)*rad, dLon=(b.lon-a.lon)*rad;
  const la1=a.lat*rad, la2=b.lat*rad;
  const h=Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}

async function buildRoute(start){
  setBusy(true);
  try{
    const pts = pickWaypoints(chosenMinutes, start);
    const coords = pts.map(p=>`${p.lon},${p.lat}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true&continue_straight=false`;
    const res = await fetch(url);
    if(!res.ok) throw new Error('Error al consultar el servicio de rutas');
    const data = await res.json();
    if(!data.routes?.length) throw new Error('No se encontró una ruta válida');
    const r = data.routes[0];
    routeSteps = r.legs.flatMap(l=>l.steps || []);
    drawRoute(r.geometry.coordinates);
    const km=(r.distance/1000).toFixed(1);
    const min=Math.max(1,Math.round(r.duration/60));
    examInstruction.classList.remove('hidden');
    examInstruction.textContent=`Ruta preparada: ${km} km · unos ${min} min según tráfico libre. Ruta de práctica, no oficial.`;
    clearRouteBtn.classList.remove('hidden');
    examBtn.disabled = routeSteps.length === 0;
  } catch(e){
    examInstruction.classList.remove('hidden');
    examInstruction.textContent = `No he podido calcular la ruta ahora: ${e.message}. Comprueba la conexión a Internet.`;
  } finally { setBusy(false); }
}

function drawRoute(coords){
  const latlngs = coords.map(([lon,lat])=>[lat,lon]);
  if(routeLayer) routeLayer.remove();
  routeLayer = L.polyline(latlngs, {weight:6, opacity:.85}).addTo(map);
  map.fitBounds(routeLayer.getBounds(), {padding:[24,24]});
}

function setBusy(b){
  $('routeFromDgtBtn').disabled=b;
  routeFromMeBtn.disabled=b || !currentPos;
  $('routeFromDgtBtn').textContent=b?'Calculando…':'Salir desde DGT';
}

function clearRoute(){
  if(routeLayer){routeLayer.remove();routeLayer=null;}
  routeSteps=[];
  clearRouteBtn.classList.add('hidden');
  examBtn.disabled=true;
  examInstruction.classList.add('hidden');
  stopExam();
}

function humanInstruction(step){
  const m = step.maneuver || {};
  const name = step.name ? ` hacia ${step.name}` : '';
  const type=m.type, mod=m.modifier || '';
  const side = mod.includes('left') ? 'izquierda' : mod.includes('right') ? 'derecha' : '';
  if(type==='roundabout' || type==='rotary'){
    const exit=m.exit ? ` y toma la salida ${m.exit}` : '';
    return `En la glorieta, continúa${exit}${name}.`;
  }
  if(type==='arrive') return 'Cuando sea posible, finaliza el recorrido en un lugar seguro.';
  if(type==='depart') return name ? `Inicia la marcha${name}.` : 'Inicia la marcha cuando sea seguro.';
  if(type==='merge') return `Incorpórate${side ? ` por la ${side}`:''}${name}.`;
  if(type==='on ramp') return `Toma la incorporación${side ? ` a la ${side}`:''}${name}.`;
  if(type==='off ramp') return `Toma la salida${side ? ` a la ${side}`:''}${name}.`;
  if(type==='fork') return `En la bifurcación, mantente${side ? ` a la ${side}`:''}${name}.`;
  if(type==='turn') return `Cuando sea posible, gira a la ${side || 'vía indicada'}${name}.`;
  if(type==='new name' || type==='continue') return `Continúa${name}.`;
  return side ? `Continúa y toma la ${side}${name}.` : `Continúa${name}.`;
}

function speak(text){
  if(!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang='es-ES'; u.rate=.95; u.pitch=1;
  speechSynthesis.speak(u);
}

function startExam(){
  if(!routeSteps.length) return;
  examBtn.classList.add('hidden');
  stopExamBtn.classList.remove('hidden');
  let i=0;
  const announce=()=>{
    if(i>=routeSteps.length){
      const text='Recorrido finalizado. Busca un lugar seguro y sigue las indicaciones del profesor.';
      examInstruction.textContent=text; speak(text); stopExam(); return;
    }
    const step=routeSteps[i++];
    const text=humanInstruction(step);
    examInstruction.classList.remove('hidden');
    examInstruction.textContent=text;
    speak(text);
    // Temporización aproximada para simulación; no sustituye navegación giro a giro real.
    const sec=Math.min(35,Math.max(8,Math.round((step.duration || 15)*.55)));
    examTimer=setTimeout(announce,sec*1000);
  };
  announce();
}

function stopExam(){
  if(examTimer){clearTimeout(examTimer);examTimer=null;}
  if('speechSynthesis' in window) speechSynthesis.cancel();
  stopExamBtn.classList.add('hidden');
  examBtn.classList.remove('hidden');
}

locateBtn.addEventListener('click', startGPS);
followBtn.addEventListener('click', ()=>{
  following=!following;
  followBtn.textContent=following?'Dejar de seguir':'Seguir GPS';
  if(following && currentPos) map.setView([currentPos.lat,currentPos.lon],16);
});
$('centerDgtBtn').addEventListener('click', ()=>map.setView([DGT.lat,DGT.lon],16));
$('routeFromDgtBtn').addEventListener('click', ()=>buildRoute({lat:DGT.lat,lon:DGT.lon}));
routeFromMeBtn.addEventListener('click', ()=>currentPos && buildRoute({lat:currentPos.lat,lon:currentPos.lon}));
clearRouteBtn.addEventListener('click', clearRoute);
examBtn.addEventListener('click', startExam);
stopExamBtn.addEventListener('click', stopExam);

document.querySelectorAll('.segmented button').forEach(btn=>btn.addEventListener('click',()=>{
  document.querySelectorAll('.segmented button').forEach(b=>b.classList.remove('selected'));
  btn.classList.add('selected'); chosenMinutes=Number(btn.dataset.min);
}));

document.querySelectorAll('.bottom-nav button').forEach(btn=>btn.addEventListener('click',()=>{
  const el=$(btn.dataset.target); if(el) el.scrollIntoView({behavior:'smooth',block:'center'});
}));

window.addEventListener('beforeinstallprompt',(e)=>{
  e.preventDefault(); deferredPrompt=e; installBtn.classList.remove('hidden');
});
installBtn.addEventListener('click',async()=>{
  if(!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt=null; installBtn.classList.add('hidden');
});
window.addEventListener('appinstalled',()=>installBtn.classList.add('hidden'));

if('serviceWorker' in navigator){
  window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
}

initMap();
