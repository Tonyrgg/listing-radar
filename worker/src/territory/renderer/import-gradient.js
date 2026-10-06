/** Proportions describe the inventory, not the physical location of its houses. */
export function gradientStops(distribution, palette) {
  const neutral = [{ at: 0, color: palette.never }, { at: 1, color: palette.never }];
  if (!distribution?.total) return neutral;
  const bands = ["recent", "aging", "stale", "never"].map(tone => ({
    color: palette[tone], weight: tone === "never" ? distribution.never + distribution.undated : distribution[tone],
  })).filter(band => band.weight > 0);
  if (!bands.length) return neutral;
  // Use counts, not rounded percentages. The entire trace always represents 100%.
  const total = bands.reduce((sum, band) => sum + band.weight, 0);
  const stops = [{ at: 0, color: bands[0].color }];
  let position = 0;
  for (let i = 0; i < bands.length - 1; i++) {
    position += bands[i].weight / total;
    const blend = Math.min(0.004, bands[i].weight / total / 4, bands[i + 1].weight / total / 4);
    stops.push({ at: position - blend, color: bands[i].color }, { at: position + blend, color: bands[i + 1].color });
  }
  stops.push({ at: 1, color: bands.at(-1).color });
  return stops;
}

export function traceMetrics(rings) {
  const edges = [];
  let total = 0;
  for (const ring of rings) for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1], b = ring[i], length = Math.hypot(b.x - a.x, b.y - a.y);
    if (!length) continue;
    edges.push({ a, b, length, start: total });
    total += length;
  }
  return { edges, total };
}

/** Leaflet Canvas keeps its existing hit testing, hover reset and one layer per street. */
export function importGradientRenderer(L, options) {
  const Renderer = L.Canvas.extend({
    _updatePoly(layer, closed) {
      const stops = layer.options.importGradient;
      if (closed || !stops || stops.every(stop => stop.color === stops[0].color)) return L.Canvas.prototype._updatePoly.call(this, layer, closed);
      if (!this._drawing || !layer._parts.length || !layer.options.stroke || !layer.options.weight) return;
      // Full projected geometry, before clipping: panning cannot redistribute colors.
      if (layer._importRings !== layer._rings) {
        layer._importRings = layer._rings;
        layer._importMetrics = traceMetrics(layer._rings);
      }
      const { edges, total } = layer._importMetrics;
      if (!total) return;
      const ctx = this._ctx;
      ctx.save();
      ctx.globalAlpha = layer.options.opacity;
      ctx.lineWidth = layer.options.weight;
      ctx.lineCap = layer.options.lineCap;
      ctx.lineJoin = layer.options.lineJoin;
      ctx.setLineDash([]);
      for (const { a, b, length, start } of edges) {
        const dx = (b.x - a.x) / length, dy = (b.y - a.y) / length;
        // Each edge samples the same cumulative gradient along the curved street.
        const gradient = ctx.createLinearGradient(a.x - dx * start, a.y - dy * start, a.x + dx * (total - start), a.y + dy * (total - start));
        for (const stop of stops) gradient.addColorStop(stop.at, stop.color);
        ctx.strokeStyle = gradient;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.restore();
    },
  });
  return new Renderer(options);
}
