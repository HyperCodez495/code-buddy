/**
 * Curated news widget — a self-contained body fragment (no external network)
 * that renders a `NewsWidgetData` payload from `window.__WIDGET_DATA__`.
 * @module widgets/curated/news
 */
export const NEWS_WIDGET_HTML = String.raw`
<style>
  .cbw-news { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    border-radius: 16px; padding: 16px 18px; color: #0b1220;
    background: #ffffff; border: 1px solid rgba(0,0,0,.08); max-width: 520px; }
  .cbw-news .cbw-h { font-size: 14px; font-weight: 700; margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
  .cbw-news ul { list-style: none; margin: 0; padding: 0; }
  .cbw-news li { padding: 9px 0; border-top: 1px solid rgba(0,0,0,.06); font-size: 14px; line-height: 1.35; }
  .cbw-news li:first-child { border-top: none; }
  .cbw-news .cbw-src { display: block; font-size: 11px; opacity: .55; margin-top: 2px; }
  .cbw-news a { color: inherit; text-decoration: none; }
  .cbw-news a:hover { text-decoration: underline; }
  @media (prefers-color-scheme: dark) {
    .cbw-news { color: #e8eefc; background: #0f1626; border-color: rgba(255,255,255,.08); }
    .cbw-news li { border-color: rgba(255,255,255,.08); }
  }
</style>
<div class="cbw-news" id="cbw-news"></div>
<script>
(function(){
  var d = (window.__WIDGET_DATA__) || {};
  var root = document.getElementById('cbw-news');
  if (!root) return;
  var esc = function(s){ return String(s==null?'':s).replace(/[&<>"]/g, function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m];}); };
  var items = Array.isArray(d.items) ? d.items.slice(0, 8) : [];
  root.innerHTML =
    '<div class="cbw-h">📰 ' + esc(d.title || "Actualités du jour") + '</div>'
    + (items.length
        ? '<ul>' + items.map(function(it){
            var title = esc(it.title || '');
            var inner = it.url ? '<a href="' + esc(it.url) + '" target="_blank" rel="noopener">' + title + '</a>' : title;
            return '<li>' + inner + (it.source ? '<span class="cbw-src">' + esc(it.source) + '</span>' : '') + '</li>';
          }).join('') + '</ul>'
        : '<div style="opacity:.6;font-size:13px">Pas d\'actualité disponible.</div>');
})();
</script>
`;
