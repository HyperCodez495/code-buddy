/**
 * Curated weather widget — a self-contained body fragment (no external network)
 * that renders a `WeatherWidgetData` payload from `window.__WIDGET_DATA__`.
 * @module widgets/curated/weather
 */
export const WEATHER_WIDGET_HTML = String.raw`
<style>
  .cbw-weather { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    border-radius: 16px; padding: 18px 20px; color: #0b1220;
    background: linear-gradient(135deg, #eaf3ff 0%, #f7fbff 100%);
    border: 1px solid rgba(0,0,0,.06); max-width: 460px; }
  .cbw-weather .cbw-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .cbw-weather .cbw-loc { font-size: 14px; font-weight: 600; opacity: .8; }
  .cbw-weather .cbw-temp { font-size: 44px; font-weight: 700; line-height: 1; }
  .cbw-weather .cbw-emoji { font-size: 44px; }
  .cbw-weather .cbw-cond { margin-top: 2px; font-size: 14px; opacity: .85; text-transform: capitalize; }
  .cbw-weather .cbw-meta { margin-top: 8px; font-size: 12px; opacity: .7; display: flex; gap: 14px; flex-wrap: wrap; }
  .cbw-weather .cbw-fc { margin-top: 14px; display: flex; gap: 10px; overflow-x: auto; }
  .cbw-weather .cbw-day { flex: 0 0 auto; text-align: center; padding: 8px 10px; border-radius: 12px;
    background: rgba(255,255,255,.6); min-width: 62px; }
  .cbw-weather .cbw-day .d { font-size: 11px; opacity: .7; text-transform: capitalize; }
  .cbw-weather .cbw-day .e { font-size: 20px; margin: 2px 0; }
  .cbw-weather .cbw-day .t { font-size: 12px; font-weight: 600; }
  @media (prefers-color-scheme: dark) {
    .cbw-weather { color: #e8eefc; background: linear-gradient(135deg, #101a2e 0%, #0b1220 100%);
      border-color: rgba(255,255,255,.08); }
    .cbw-weather .cbw-day { background: rgba(255,255,255,.06); }
  }
</style>
<div class="cbw-weather" id="cbw-weather"></div>
<script>
(function(){
  var d = (window.__WIDGET_DATA__) || {};
  function emoji(cond){
    var c = String(cond||'').toLowerCase();
    if (/orage|thunder|storm/.test(c)) return '⛈️';
    if (/neige|snow/.test(c)) return '🌨️';
    if (/pluie|rain|averse|drizzle|bruine/.test(c)) return '🌧️';
    if (/brou|fog|mist|brume/.test(c)) return '🌫️';
    if (/nuag|cloud|couvert|overcast/.test(c)) return '☁️';
    if (/éclair|partiel|partly/.test(c)) return '⛅';
    if (/soleil|clear|ensole|sunny|dégagé|degage/.test(c)) return '☀️';
    return '🌡️';
  }
  var unit = d.units === 'imperial' ? '°F' : '°C';
  var cur = d.current || {};
  var root = document.getElementById('cbw-weather');
  if (!root) return;
  var meta = [];
  if (cur.feelsLike != null) meta.push('Ressenti ' + Math.round(cur.feelsLike) + unit);
  if (cur.humidity != null) meta.push('💧 ' + cur.humidity + '%');
  if (cur.windSpeed != null) meta.push('💨 ' + cur.windSpeed + ' km/h');
  var fc = Array.isArray(d.forecast) ? d.forecast.slice(0,5) : [];
  var esc = function(s){ return String(s==null?'':s).replace(/[&<>]/g, function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[m];}); };
  root.innerHTML =
    '<div class="cbw-top"><div>'
      + '<div class="cbw-loc">' + esc(d.location || 'Météo') + '</div>'
      + '<div class="cbw-temp">' + (cur.temperature!=null?Math.round(cur.temperature):'—') + unit + '</div>'
      + '<div class="cbw-cond">' + esc(cur.condition || '') + '</div>'
      + '</div><div class="cbw-emoji">' + emoji(cur.condition) + '</div></div>'
    + (meta.length ? '<div class="cbw-meta">' + meta.map(esc).join('<span>·</span>') + '</div>' : '')
    + (fc.length ? '<div class="cbw-fc">' + fc.map(function(f){
        return '<div class="cbw-day"><div class="d">' + esc(f.day) + '</div>'
          + '<div class="e">' + emoji(f.condition) + '</div>'
          + '<div class="t">' + (f.max!=null?Math.round(f.max):'—') + '° / ' + (f.min!=null?Math.round(f.min):'—') + '°</div></div>';
      }).join('') + '</div>' : '');
})();
</script>
`;
